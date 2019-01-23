const conf = require('ocore/conf');
const db = require('ocore/db');
const notifications = require('./notifications');
const bitcointalkAttestation = require('./bitcointalk-attestation');

exports.distributionAddress = null;

function sendReward(outputs, deviceAddress, onDone) {
	const headlessWallet = require('headless-obyte');
	headlessWallet.sendMultiPayment({
		asset: null,
		base_outputs: outputs,
		paying_addresses: [exports.distributionAddress],
		change_address: exports.distributionAddress,
		recipient_device_address: deviceAddress,
	}, (err, unit) => {
		if (err) {
			console.log(`failed to send reward: ${err}`);
			const balances = require('ocore/balances');
			balances.readOutputsBalance(exports.distributionAddress, (balance) => {
				console.error(balance);
				notifications.notifyAdmin('failed to send reward', `${err}, balance: ${JSON.stringify(balance)}`);
			});
		} else {
			console.log(`sent reward, unit ${unit}`);
		}
		onDone(err, unit);
	});
}


function sendAndWriteReward(rewardType, transactionId) {
	const mutex = require('ocore/mutex.js');
	let table;
	let deviceAddressColumn;
	if (rewardType === 'referral') {
		table = 'referral_reward_units';
		deviceAddressColumn = `(
			SELECT device_address
			FROM receiving_addresses
			WHERE receiving_addresses.user_address=${table}.user_address
			ORDER BY rowid DESC
			LIMIT 1
		) AS device_address`;
	} else {
		table = 'reward_units';
		deviceAddressColumn = 'receiving_addresses.device_address';
	}

	mutex.lock([`tx-${transactionId}`], (unlock) => {
		db.query(
			`SELECT 
				${deviceAddressColumn},
				reward_date, reward, ${table}.user_address,
				contract_reward, contract_address
			FROM ${table}
			CROSS JOIN transactions USING(transaction_id)
			CROSS JOIN receiving_addresses USING(receiving_address)
			LEFT JOIN contracts ON ${table}.user_address=contracts.user_address 
			WHERE transaction_id=?`,
			[transactionId],
			(rows) => {
				if (!rows.length) {
					throw Error(`no record in ${table} for tx ${transactionId}`);
				}
				const row = rows[0];
				if (row.reward_date) { // already sent
					return unlock();
				}
				if (row.contract_reward && !row.contract_address) {
					throw Error(`no contract address for reward ${rewardType} ${transactionId}`);
				}
				const outputs = [];
				if (row.reward) {
					outputs.push({ address: row.user_address, amount: row.reward });
				}
				if (row.contract_reward) {
					outputs.push({ address: row.contract_address, amount: row.contract_reward });
				}
				if (!outputs.length) {
					throw Error(`no rewards in tx ${rewardType} ${transactionId}`);
				}
				sendReward(outputs, row.device_address, (err, unit) => {
					if (err) {
						return unlock();
					}
					db.query(
						`UPDATE ${table}
						SET reward_unit=?, reward_date=${db.getNow()}
						WHERE transaction_id=?`,
						[unit, transactionId],
						() => {
							const device = require('ocore/device.js');
							device.sendMessageToDevice(row.device_address, 'text', `Sent the ${rewardType} reward`);
							unlock();
						},
					);
				});
			},
		);
	});
}

function retrySendingRewardsOfType(rewardType) {
	const tableName = (rewardType === 'referral') ? 'referral_reward_units' : 'reward_units';
	db.query(
		`SELECT transaction_id
		FROM ${tableName}
		WHERE reward_unit IS NULL
		LIMIT 5`,
		(rows) => {
			rows.forEach((row) => {
				sendAndWriteReward(rewardType, row.transaction_id);
			});
		},
	);
}

function retrySendingRewards() {
	retrySendingRewardsOfType('attestation');
	retrySendingRewardsOfType('referral');
}

function findReferrer(paymentUnit, userAddress, deviceAddress, handleReferrer) {
	const assocMcisByAddress = {};
	let depth = 0;
	if (!bitcointalkAttestation.bitcointalkAttestorAddress) {
		throw Error('no bitcointalkAttestorAddress in reward');
	}

	function goBack(arrUnits) {
		depth++;
		// console.error('goBack', depth, arrUnits);
		if (!arrUnits || !arrUnits.length) return tryToFindLinkReferrer();
		db.query(
			`SELECT 
				address, src_unit, main_chain_index 
			FROM inputs 
			JOIN units ON src_unit=units.unit
			WHERE inputs.unit IN(?) 
				AND type='transfer' 
				AND asset IS NULL`,
			[arrUnits],
			(rows) => {
				rows.forEach((row) => {
					if (row.address === userAddress) { // no self-refferrers
						return;
					}
					if (!assocMcisByAddress[row.address] || assocMcisByAddress[row.address] < row.main_chain_index) {
						assocMcisByAddress[row.address] = row.main_chain_index;
					}
				});
				const arrSrcUnits = rows.map((row) => row.src_unit); // eslint-disable-line arrow-parens
				if (depth < conf.MAX_REFERRAL_DEPTH) {
					goBack(arrSrcUnits);
				} else {
					selectReferrer();
				}
			},
		);
	}

	function selectReferrer() {
		const arrAddresses = Object.keys(assocMcisByAddress);
		console.log(`findReferrer ${paymentUnit}: ancestor addresses: ${arrAddresses.join(', ')}`);
		if (!arrAddresses.length) {
			return tryToFindLinkReferrer();
		}
		db.query(
			`SELECT 
				address, user_address, device_address, bt_user_id, payload, app
			FROM attestations
			JOIN messages USING(unit, message_index)
			JOIN attestation_units ON unit=attestation_unit
			JOIN transactions USING(transaction_id)
			JOIN receiving_addresses USING(receiving_address)
			LEFT JOIN accepted_payments USING(transaction_id)
			WHERE address IN(${arrAddresses.map(db.escape).join(', ')}) 
				AND +attestor_address=? 
				AND (accepted_payments.payment_unit IS NULL OR accepted_payments.payment_unit!=?)`,
			[bitcointalkAttestation.bitcointalkAttestorAddress, paymentUnit],
			(rows) => {
				if (!rows.length) {
					console.log(`findReferrer ${paymentUnit}: no referrers`);
					return tryToFindLinkReferrer();
				}

				let maxMci = 0;
				let bestUserId;
				let bestRow;
				rows.forEach((row) => {
					if (row.app !== 'attestation') {
						throw Error(`unexpected app ${row.app} for payment ${paymentUnit}`);
					}
					if (row.address !== row.user_address) {
						throw Error(`different addresses: address ${row.address}, user_address ${row.user_address} for payment ${paymentUnit}`);
					}

					const payload = JSON.parse(row.payload);
					if (payload.address !== row.address) {
						throw Error(`different addresses: address ${row.address}, payload ${row.payload} for payment ${paymentUnit}`);
					}

					const userId = payload.profile.user_id;
					if (!userId) {
						throw Error(`no user_id for payment ${paymentUnit}`);
					}

					const mci = assocMcisByAddress[row.address];
					if (mci > maxMci) {
						maxMci = mci;
						bestRow = row;
						bestUserId = userId;
					}
				});
				if (!bestRow || !bestUserId) {
					throw Error(`no best for payment ${paymentUnit}`);
				}

				console.log(`findReferrer ${paymentUnit}: found payment referrer for user ${userAddress}: ${bestRow.user_address}`);
				if (bestRow.device_address === deviceAddress) { // no self-referring
					console.log(`findReferrer ${paymentUnit}: self-referring`);
					return tryToFindLinkReferrer();
				}
				handleReferrer(bestUserId, bestRow.user_address, bestRow.device_address, bestRow.bt_user_id);
			},
		);
	}
	
	function tryToFindLinkReferrer() {
		console.log(`tryToFindLinkReferrer ${userAddress}`);
		db.query(
			`SELECT
				referring_user_address, payload, app, type,
				receiving_addresses.device_address,
				receiving_addresses.user_address, receiving_addresses.bt_user_id
			FROM link_referrals 
			CROSS JOIN attestations ON referring_user_address=attestations.address AND attestor_address=?
			CROSS JOIN messages USING(unit, message_index)
			CROSS JOIN attestation_units ON unit=attestation_unit
			CROSS JOIN transactions USING(transaction_id)
			CROSS JOIN receiving_addresses USING(receiving_address)
			WHERE link_referrals.device_address=? 
				AND receiving_addresses.device_address != link_referrals.device_address
				AND referring_user_address != ?
			ORDER BY link_referrals.creation_date DESC LIMIT 1`,
			[bitcointalkAttestation.bitcointalkAttestorAddress, deviceAddress, userAddress],
			(rows) => {
				if (!rows.length) {
					return handleReferrer();
				}
				const row = rows[0];
				console.log(`found ${row.type} referrer for device ${deviceAddress}: ${row.referring_user_address}`);
				if (row.app !== 'attestation') {
					throw Error(`unexpected app ${row.app} for attestation of user who referred ${deviceAddress}`);
				}
				if (row.referring_user_address !== row.user_address) {
					throw Error(`different addresses: referring_user_address ${row.referring_user_address}, user_address ${row.user_address} for device ${deviceAddress}`);
				}
				const payload = JSON.parse(row.payload);
				if (payload.address !== row.referring_user_address) {
					throw Error(`different addresses: referring_user_address ${row.referring_user_address}, payload ${row.payload} for device ${deviceAddress}`);
				}
				const referringProfileId = payload.profile.user_id;
				if (!referringProfileId) {
					throw Error(`no proflie id for device ${deviceAddress} payload ${row.payload}`);
				}
				handleReferrer(referringProfileId, row.referring_user_address, row.device_address, row.bt_user_id);
			},
		);
	}
	
	console.log(`findReferrer ${paymentUnit}, ${userAddress}, ${deviceAddress}`);
	if (paymentUnit) {
		goBack([paymentUnit]);
	} else {
		tryToFindLinkReferrer();
	}
}

exports.sendAndWriteReward = sendAndWriteReward;
exports.retrySendingRewards = retrySendingRewards;
exports.findReferrer = findReferrer;
