const constants = require('byteballcore/constants');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const texts = require('./modules/texts');
const bitcointalkAttestation = require('./modules/bitcointalk-attestation');
const api = require('./modules/bitcointalk-api');
const reward = require('./modules/reward');
const notifications = require('./modules/notifications');
const contract = require('./modules/contract');
const server = require('./modules/web-server');
const receivingAddresses = require('./modules/receiving-addresses');
const conversion = require('./modules/conversion'); // eslint-disable-line no-unused-vars

process.on('unhandledRejection', (up) => { throw up; });

/**
 * user pairs his device with bot
 */
eventBus.on('paired', (fromAddress, pairingSecret) => {
	respond(fromAddress, '', texts.greeting());
	if (!validationUtils.isValidAddress(pairingSecret)) {
		console.log('pairing without referrer in pairing code'); // eslint-disable-line no-console
		return;
	}

	const referringUserAddress = pairingSecret;
	db.query(
		'SELECT 1 FROM attestations WHERE address=? AND attestor_address=?',
		[referringUserAddress, bitcointalkAttestation.bitcointalkAttestorAddress],
		(rows) => {
			if (!rows.length) {
				// eslint-disable-next-line no-console
				console.log(`referrer ${referringUserAddress} not attested, ignoring referrer pairing code`);
				return;
			}

			console.log(`paired device ${fromAddress} fererred by ${referringUserAddress}`); // eslint-disable-line no-console
			db.query(
				`INSERT ${db.getIgnore()} INTO link_referrals
				(referring_user_address, device_address, type)
				VALUES(?, ?, 'pairing')`,
				[referringUserAddress, fromAddress],
			);
		},
	);
});

/**
 * user sends message to the bot
 */
eventBus.once('headless_and_rates_ready', () => { // we need rates to handle some messages
	const headlessWallet = require('headless-byteball');
	eventBus.on('text', (fromAddress, text) => {
		respond(fromAddress, text.trim());
	});
	if (conf.bRunWitness) {
		require('byteball-witness');
		eventBus.emit('headless_wallet_ready');
	} else {
		headlessWallet.setupChatEventHandlers();
	}
});

/**
 * user pays to the bot
 */
eventBus.on('new_my_transactions', handleNewTransactions);

/**
 * payment is confirmed
 */
if (!conf.bAcceptUnconfirmedPayments) {
	eventBus.on('my_transactions_became_stable', handleTransactionsBecameStable);
}

/**
 * ready headless wallet
 */
eventBus.once('headless_wallet_ready', handleWalletReady);

function handleWalletReady() {
	let error = '';

	/**
	 * check if database tables are created
	 */
	const arrTableNames = [
		'users', 'receiving_addresses', 'transactions', 'attestation_units', 'accepted_payments',
		'rejected_payments', 'signed_messages', 'reward_units', 'referral_reward_units',
		'contracts', 'link_referrals',
	];
	db.query(
		"SELECT name FROM sqlite_master WHERE type='table' AND NAME IN (?)",
		[arrTableNames],
		(rows) => {
			if (rows.length !== arrTableNames.length) {
				error += texts.errorInitSql();
			}

			/**
			 * check if config is filled correct
			 */
			if (!conf.admin_email || !conf.from_email) {
				error += texts.errorConfigEmail();
			}
			if (!conf.salt) {
				error += texts.errorConfigSalt();
			}

			if (error) {
				throw new Error(error);
			}

			const headlessWallet = require('headless-byteball');
			headlessWallet.issueOrSelectAddressByIndex(0, 0, (address1) => {
				console.log(`== bitcointalk attestation address: ${address1}`); // eslint-disable-line no-console
				bitcointalkAttestation.bitcointalkAttestorAddress = address1;

				headlessWallet.issueOrSelectAddressByIndex(0, 1, (address2) => {
					console.log(`== distribution address: ${address2}`); // eslint-disable-line no-console
					reward.distributionAddress = address2;

					setInterval(bitcointalkAttestation.retryPostingAttestations, 60 * 1000);
					setInterval(reward.retrySendingRewards, 60 * 1000);
					setInterval(moveFundsToAttestorAddresses, 60 * 1000);

					const consolidation = require('headless-byteball/consolidation.js');
					consolidation.scheduleConsolidation(
						bitcointalkAttestation.bitcointalkAttestorAddress,
						headlessWallet.signer,
						100,
						3600 * 1000,
					);

					server.start();
				});
			});
		},
	);
}

function moveFundsToAttestorAddresses() {
	const network = require('byteballcore/network.js');
	const mutex = require('byteballcore/mutex.js');
	if (network.isCatchingUp()) {
		return;
	}

	mutex.lock(['moveFundsToAttestorAddresses'], (unlock) => {
		db.query(
			`SELECT * FROM (
				SELECT DISTINCT receiving_address
				FROM receiving_addresses 
				CROSS JOIN outputs ON receiving_address = address 
				JOIN units USING(unit)
				WHERE is_stable=1 AND is_spent=0 AND asset IS NULL
			) AS t
			WHERE NOT EXISTS (
				SELECT * FROM units CROSS JOIN unit_authors USING(unit)
				WHERE is_stable=0 AND unit_authors.address=t.receiving_address AND definition_chash IS NOT NULL
			)
			LIMIT ?`,
			[constants.MAX_AUTHORS_PER_UNIT],
			(rows) => {
				// console.error('moveFundsToAttestorAddresses', rows);
				if (!rows.length) {
					return unlock();
				}

				const arrAddresses = rows.map(row => row.receiving_address);
				const headlessWallet = require('headless-byteball');
				headlessWallet.sendMultiPayment({
					asset: null,
					to_address: bitcointalkAttestation.steemAttestorAddress,
					send_all: true,
					paying_addresses: arrAddresses,
				}, (err, unit) => {
					if (err) {
						console.error('failed to move funds:', err); // eslint-disable-line no-console
						const balances = require('byteballcore/balances');
						balances.readBalance(arrAddresses[0], (balance) => {
							console.error('balance', balance); // eslint-disable-line no-console
							notifications.notifyAdmin('failed to move funds', `${err}, balance: ${JSON.stringify(balance)}`);
							unlock();
						});
					} else {
						console.log(`moved funds, unit: ${unit}`); // eslint-disable-line no-console
						unlock();
					}
				});
			},
		);
	});
}

function handleNewTransactions(arrUnits) {
	const device = require('byteballcore/device.js');
	db.query(
		`SELECT
			amount, asset, unit,
			receiving_address, device_address, user_address, bt_user_id, price, 
			${db.getUnixTimestamp('last_price_date')} AS price_ts
		FROM outputs
		CROSS JOIN receiving_addresses ON receiving_addresses.receiving_address = outputs.address
		WHERE unit IN(?)
			AND NOT EXISTS (
				SELECT 1
				FROM unit_authors
				CROSS JOIN my_addresses USING(address)
				WHERE unit_authors.unit = outputs.unit
			)`,
		[arrUnits],
		(rows) => {
			rows.forEach((row) => {

				checkPayment(row, (error) => {
					if (error) {
						return db.query(
							`INSERT ${db.getIgnore()} INTO rejected_payments
							(receiving_address, price, received_amount, payment_unit, error)
							VALUES (?,?,?,?,?)`,
							[row.receiving_address, row.price, row.amount, row.unit, error],
							() => {
								device.sendMessageToDevice(row.device_address, 'text', error);
							},
						);
					}

					db.query(
						`INSERT INTO transactions
						(receiving_address, proof_type)
						VALUES (?, 'payment')`,
						[row.receiving_address],
						(res) => {
							const transactionId = res.insertId;
							db.query(
								`INSERT INTO accepted_payments
								(transaction_id, receiving_address, price, received_amount, payment_unit)
								VALUES (?,?,?,?,?)`,
								[transactionId, row.receiving_address, row.price, row.amount, row.unit],
								() => {
									if (conf.bAcceptUnconfirmedPayments) {
										device.sendMessageToDevice(row.device_address, 'text', texts.receivedAndAcceptedYourPayment(row.amount));
										handleTransactionsBecameStable([row.unit]);
									} else {
										device.sendMessageToDevice(row.device_address, 'text', texts.receivedYourPayment(row.amount));
									}
								},
							);
						},
					);
				}); // checkPayment
			});
		},
	);
}

function checkPayment(row, onDone) {
	if (row.asset !== null) {
		return onDone('Received payment in wrong asset');
	}

	if (row.amount < conf.priceInBytes) {
		const text = `Received ${row.amount} Bytes from you, which is less than the expected ${conf.priceInBytes} Bytes.`;
		const challenge = `${row.bt_user_id} ${row.user_address}`;
		return onDone(`${text}\n\n'${texts.pleasePay(row.receiving_address, conf.priceInBytes, challenge)}`);
	}

	function resetUserAddress() {
		db.query('UPDATE users SET user_address=NULL WHERE device_address=?', [row.device_address]);
	}
	
	db.query('SELECT address FROM unit_authors WHERE unit=?', [row.unit], (authorRows) => {
		if (authorRows.length !== 1) {
			resetUserAddress();
			return onDone(
				`Received a payment but looks like it was not sent from a single-address wallet.\n${texts.switchToSingleAddress()}`,
			);
		}
		if (authorRows[0].address !== row.user_address) {
			resetUserAddress();
			return onDone(
				`Received a payment but it was not sent from the expected address ${row.user_address}.\n${texts.switchToSingleAddress()}`,
			);
		}
		onDone();
	});
}

function handleTransactionsBecameStable(arrUnits) {
	const device = require('byteballcore/device.js');
	db.query(
		`SELECT
			transaction_id, device_address, user_address,
			bt_user_id, bt_user_name,
			bt_user_rank, bt_user_rank_index,
			bt_user_activity, bt_user_posts,
			post_publicly, payment_unit
		FROM accepted_payments
		JOIN receiving_addresses USING(receiving_address)
		WHERE payment_unit IN(?)`,
		[arrUnits],
		(rows) => {
			rows.forEach((row) => {
				db.query(
					`UPDATE accepted_payments SET confirmation_date=${db.getNow()}, is_confirmed=1 WHERE transaction_id=?`,
					[row.transaction_id],
					() => {
						if (!conf.bAcceptUnconfirmedPayments) {
							device.sendMessageToDevice(row.device_address, 'text', texts.paymentIsConfirmed());
						}
						attest(row, 'payment');
					},
				);
			}); // forEach
		},
	);
}

/**
 * scenario for responding to user requests
 * @param from_address
 * @param text
 * @param response
 */
function respond(fromAddress, text, response = '') {
	const device = require('byteballcore/device.js');

	handleAdminRequest(fromAddress, text, response, (adminAnswer) => {
		if (adminAnswer) {
			return device.sendMessageToDevice(fromAddress, 'text', messageNewLine(response) + adminAnswer);
		}

		readUserInfo(fromAddress, (userInfo) => {
			function checkUserAddress(onDone) {
				if (validationUtils.isValidAddress(text)) {
					userInfo.user_address = text;
					userInfo.bt_user_id = null;
					response += texts.goingToAttestAddress(userInfo.user_address);
					return db.query(
						'UPDATE users SET user_address=? WHERE device_address=?',
						[userInfo.user_address, fromAddress],
						() => {
							onDone();
						},
					);
				}
				if (userInfo.user_address) {
					return onDone();
				}
				onDone(texts.insertMyAddress());
			}

			function checkProfileId(onDone) {
				const profileId = api.checkProfileUserId(text);
				if (profileId) {
					userInfo.bt_user_id = profileId;
					response += texts.goingToAttestProfile(profileId);
					return db.query(
						'UPDATE users SET bt_user_id=? WHERE device_address=? AND user_address=?',
						[profileId, fromAddress, userInfo.user_address],
						() => {
							onDone();
						},
					);
				}
				if (userInfo.bt_user_id) {
					return onDone();
				}
				onDone(texts.insertBitcointalkProfileLink());
			}

			function checkProfileName(onDone) {
				if (userInfo.user_name) {
					return onDone();
				}
				const link = api.getLoginURL(userInfo.user_address);
				onDone(texts.proveProfile(link));
			}

			checkUserAddress((userAddressResponse) => {
				if (userAddressResponse) {
					return device.sendMessageToDevice(fromAddress, 'text', messageNewLine(response) + userAddressResponse);
				}

				checkProfileId((profileIdResponse) => {
					if (profileIdResponse) {
						return device.sendMessageToDevice(fromAddress, 'text', messageNewLine(response) + profileIdResponse);
					}

					checkProfileName((profileNameResponse) => {
						if (profileNameResponse) {
							return device.sendMessageToDevice(fromAddress, 'text', messageNewLine(response) + profileNameResponse);
						}
					
						receivingAddresses.readOrAssign(userInfo, (receivingAddress, postPublicly) => {
							const price = conf.priceInBytes;

							if (text === 'private' || text === 'public') {
								postPublicly = (text === 'public') ? 1 : 0;
								db.query(
									`UPDATE receiving_addresses 
									SET post_publicly=? 
									WHERE device_address=? AND user_address=? AND bt_user_id=?`,
									[postPublicly, fromAddress, userInfo.user_address, userInfo.bt_user_id],
								);
								response += (text === 'private') ? texts.privateChosen() : texts.publicChosen(userInfo.user_name, userInfo.bt_user_id);
							}

							if (postPublicly === null) {
								return device.sendMessageToDevice(fromAddress, 'text', messageNewLine(response) + texts.privateOrPublic());
							}
							if (text === 'again') {
								const link = api.getLoginURL(userInfo.user_address);
								return device.sendMessageToDevice(fromAddress, 'text', messageNewLine(response) + texts.proveProfile(link));
							}

							// handle signed message
							const challenge = `${userInfo.bt_user_id} ${userInfo.user_address}`;
							const arrSignedMessageMatches = text.match(/\(signed-message:(.+?)\)/);
							if (arrSignedMessageMatches) {
								const signedMessageBase64 = arrSignedMessageMatches[1];
								const validation = require('byteballcore/validation');
								const signedMessageJson = Buffer.from(signedMessageBase64, 'base64').toString('utf8');
								console.error(signedMessageJson); // eslint-disable-line no-console

								let objSignedMessage;
								try {
									objSignedMessage = JSON.parse(signedMessageJson);
								} catch (e) {
									return null;
								}

								return validation.validateSignedMessage(objSignedMessage, (err) => {
									if (err) {
										return device.sendMessageToDevice(fromAddress, 'text', err);
									}
									if (objSignedMessage.signed_message !== challenge) {
										return device.sendMessageToDevice(fromAddress, 'text', `You signed a wrong message: ${objSignedMessage.signed_message}, expected: ${challenge}`);
									}
									if (objSignedMessage.authors[0].address !== userInfo.user_address) {
										return device.sendMessageToDevice(fromAddress, 'text', `You signed the message with a wrong address: ${objSignedMessage.authors[0].address}, expected: ${userInfo.user_address}`);
									}

									db.query(
										`SELECT 1
										FROM signed_messages
										WHERE user_address=? AND creation_date > ${db.addTime('-1 DAY')}`,
										[userInfo.user_address],
										(rows) => {
											if (rows.length > 0) {
												return device.sendMessageToDevice(fromAddress, 'text', texts.alreadAttested());
											}

											db.query(
												"INSERT INTO transactions (receiving_address, proof_type) VALUES (?, 'signature')",
												[receivingAddress],
												(res) => {
													const { insertId: transactionId } = res;
													db.query(
														'INSERT INTO signed_messages (transaction_id, user_address, signed_message) VALUES (?,?,?)',
														[transactionId, userInfo.user_address, signedMessageJson],
														() => {
															db.query(
																`SELECT
																	device_address, user_address,
																	bt_user_id, bt_user_name,
																	bt_user_rank, bt_user_rank_index,
																	bt_user_activity, bt_user_posts,
																	post_publicly
																FROM receiving_addresses
																WHERE receiving_address=?`,
																[receivingAddress],
																(rows) => {
																	const row = rows[0];
																	if (!row) {
																		throw Error(`no receiving address ${receivingAddress}`);
																	}
																	row.transaction_id = transactionId;
																	attest(row, 'signature');
																},
															);
														},
													);
												},
											);
										},
									);
								});
							}

							db.query(
								`SELECT transaction_id, is_confirmed, received_amount, user_address, attestation_date
								FROM accepted_payments
								JOIN receiving_addresses USING(receiving_address)
								LEFT JOIN attestation_units USING(transaction_id)
								WHERE receiving_address=?
								ORDER BY transaction_id DESC
								LIMIT 1`,
								[receivingAddress],
								(rows) => {
									/**
									 * if user didn't pay yet
									 */
									if (!rows.length) {
										return device.sendMessageToDevice(
											fromAddress,
											'text',
											messageNewLine(response) + texts.pleasePayOrPrivacy(receivingAddress, price, challenge, postPublicly),
										);
									}

									const row = rows[0];
									/**
									 * if user paid, but transaction did not become stable
									 */
									if (!row.is_confirmed) {
										return device.sendMessageToDevice(
											fromAddress,
											'text',
											messageNewLine(response) + texts.receivedYourPayment(row.received_amount),
										);
									}
									
									device.sendMessageToDevice(
										fromAddress,
										'text',
										messageNewLine(response) + texts.alreadyAttested(row.attestation_date),
									);
								},
							);
						});
					});
				});
			});
		});
	});
}

function handleAdminRequest(fromAddress, text, response, onDone) {
	if (!conf.admin.isActive) {
		return onDone();
	}

	if (!conf.admin.deviceAddresses.includes(fromAddress)) {
		return onDone();
	}

	if (text.indexOf('ref ') === 0) {
		const data = text.slice(4);
		if (!data) {
			return onDone();
		}

		let query;
		if (validationUtils.isValidAddress(data)) {
			query = `SELECT
				bt_user_name, bt_user_id
			FROM receiving_addresses
			JOIN link_referrals ON link_referrals.referring_user_address=receiving_addresses.user_address
			WHERE
				link_referrals.type='cookie'
				AND link_referrals.device_address IN(
					SELECT
						device_address
					FROM receiving_addresses
					JOIN transactions USING(transaction_id, receiving_address)
					JOIN accepted_payments USING(transaction_id, receiving_address)
					WHERE
						accepted_payments.is_confirmed=1
						AND receiving_addresses.user_address=?
				)`;
		} else {
			query = `SELECT
				bt_user_name, bt_user_id
			FROM receiving_addresses
			JOIN link_referrals ON link_referrals.referring_user_address=receiving_addresses.user_address
			WHERE
				link_referrals.type='cookie'
				AND link_referrals.device_address IN(
					SELECT
						device_address
					FROM receiving_addresses
					JOIN transactions USING(transaction_id, receiving_address)
					JOIN accepted_payments USING(transaction_id, receiving_address)
					WHERE
						accepted_payments.is_confirmed=1
						AND receiving_addresses.bt_user_name=?
				)`;
		}
		return db.query(
			query,
			[data],
			(rows) => {
				if (!rows.length) {
					return onDone();
				}

				return onDone(texts.listOfReferrals(rows));
			},
		);
	}
	return onDone();
}

function messageNewLine(text) {
	if (text) {
		return `${text}\n\n`;
	}
	return '';
}

/**
 * get user's information by device address
 * or create new user, if it's new device address
 * @param device_address
 * @param callback
 */
function readUserInfo(deviceAddress, callback) {
	db.query(
		`SELECT
			users.user_address, users.device_address,
			users.bt_user_id, receiving_addresses.bt_user_name
		FROM users
		LEFT JOIN receiving_addresses USING(device_address, user_address)
		WHERE device_address=?`,
		[deviceAddress],
		(rows) => {
			if (rows.length) {
				const row = rows[0];
				callback(row);
			} else {
				db.query(
					`INSERT ${db.getIgnore()} INTO users (device_address) VALUES(?)`,
					[deviceAddress],
					() => {
						callback({ device_address: deviceAddress });
					},
				);
			}
		},
	);
}

function attest(row, proofType) {
	const device = require('byteballcore/device.js');
	const mutex = require('byteballcore/mutex.js');
	const transactionId = row.transaction_id;
	if (row.bt_user_rank === null) {
		throw Error(`attest: no rank in tx ${transactionId}`);
	}
	mutex.lock([`tx-${transactionId}`], (unlock) => {
		db.query(
			`INSERT ${db.getIgnore()} INTO attestation_units (transaction_id) VALUES (?)`,
			[transactionId],
			() => {
				const [attestation, srcProfile] = bitcointalkAttestation.getAttestationPayloadAndSrcProfile(
					row.user_address,
					row.bt_user_id,
					row.bt_user_name,
					row.bt_user_rank,
					row.bt_user_rank_index,
					row.bt_user_activity,
					row.bt_user_posts,
					row.post_publicly,
				);

				bitcointalkAttestation.postAndWriteAttestation(
					transactionId,
					bitcointalkAttestation.bitcointalkAttestorAddress,
					attestation,
					srcProfile,
				);

				let rewardInUSD = getRewardInUSDByRank(row.bt_user_rank);
				if (!rewardInUSD) {
					return unlock();
				}
				
				if (proofType === 'signature') {
					rewardInUSD *= conf.signingRewardShare;
				}
				const fullRewardInBytes = conversion.getPriceInBytes(rewardInUSD);
				const rewardInBytes = Math.round(fullRewardInBytes * conf.rewardContractShare);
				const contractRewardInBytes = Math.round(fullRewardInBytes * (1 - conf.rewardContractShare));
				db.query(
					`INSERT ${db.getIgnore()} INTO reward_units
					(transaction_id, device_address, user_address, user_id, reward, contract_reward)
					VALUES (?, ?,?,?,?, ?,?)`,
					[transactionId, row.device_address, row.user_address, attestation.profile.user_id, rewardInBytes, contractRewardInBytes],
					async (res) => {
						console.error(`reward_units insertId: ${res.insertId}, affectedRows: ${res.affectedRows}`);
						if (!res.affectedRows) {
							console.log(`duplicate user_address or user_id: ${row.user_address}, ${attestation.profile.user_id}`);
							return unlock();
						}
						
						const [contractAddress, vestingTs] = await contract.createContract(row.user_address, row.device_address);
						device.sendMessageToDevice(
							row.device_address,
							'text',
							texts.attestedFirstTimeBonus(rewardInUSD, rewardInBytes, contractRewardInBytes, vestingTs, row.bt_user_name, row.bt_user_id),
						);
						reward.sendAndWriteReward('attestation', transactionId);

						const referralRewardInUSD = getRewardInUSDByRank(row.bt_user_rank);
						if (!referralRewardInUSD) {
							return unlock();
						}

						const referralRewardInBytes = conversion.getPriceInBytes(referralRewardInUSD * (1 - conf.referralRewardContractShare));
						const contractReferralRewardInBytes = conversion.getPriceInBytes(referralRewardInUSD * conf.referralRewardContractShare);
						reward.findReferrer(
							row.payment_unit, row.user_address, row.device_address,
							async (referringUserId, referringUserAddress, referringUserDeviceAddress) => {
								if (!referringUserAddress) {
									// console.error("no referring user for " + row.user_address);
									console.log(`no referring user for ${row.user_address}`);
									return unlock();
								}
								const [referrerContractAddress, referrerVestingDateTs] = await contract
									.getReferrerContract(referringUserAddress, referringUserDeviceAddress);

								db.query(
									`INSERT ${db.getIgnore()} INTO referral_reward_units
									(transaction_id, user_address, user_id, new_user_address, new_user_id, reward, contract_reward)
									VALUES (?, ?,?, ?,?, ?,?)`,
									[
										transactionId, referringUserAddress, referringUserId,
										row.user_address, attestation.profile.user_id,
										referralRewardInBytes, contractReferralRewardInBytes,
									],
									(res) => {
										console.log(`referral_reward_units insertId: ${res.insertId}, affectedRows: ${res.affectedRows}`);
										if (!res.affectedRows) {
											notifications.notifyAdmin('duplicate referral reward', `referral reward for new user ${row.user_address} ${attestation.profile.user_id} already written`);
											return unlock();
										}

										device.sendMessageToDevice(
											referringUserDeviceAddress,
											'text',
											texts.referredUserBonus(
												referralRewardInUSD, referralRewardInBytes, contractReferralRewardInBytes, referrerVestingDateTs,
												row.bt_user_name, row.bt_user_id,
											),
										);
										reward.sendAndWriteReward('referral', transactionId);
										unlock();
									},
								);
							},
						);
					},
				);
			},
		);
	});
}

function getRewardInUSDByRank(rank) {
	if (rank in conf.listRankRewardsInUsd) {
		return conf.listRankRewardsInUsd[rank];
	}
	return 0;
}
