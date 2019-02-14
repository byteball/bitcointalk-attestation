const conf = require('ocore/conf');
const objectHash = require('ocore/object_hash');
const db = require('ocore/db');
const notifications = require('./notifications');
const texts = require('./texts');

function retryPostingAttestations() {
	if (!exports.bitcointalkAttestorAddress) {
		throw Error('no bitcointalkAttestorAddress');
	}
	db.query(
		`SELECT
			transaction_id, user_address,
			bt_user_id, bt_user_name,
			bt_user_rank, bt_user_rank_index,
			bt_user_activity, bt_user_posts,
			post_publicly
		FROM attestation_units
		JOIN transactions USING(transaction_id)
		JOIN receiving_addresses USING(receiving_address)
		WHERE attestation_unit IS NULL`,
		(rows) => {
			rows.forEach((row) => {
				if (row.bt_user_rank === null) {
					throw Error(`no rep in tx ${row.transaction_id}`);
				}
				const [attestation, srcProfile] = getAttestationPayloadAndSrcProfile(
					row.user_address,
					row.post_publicly,
					row,
				);
				// eslint-disable-next-line no-console
				console.log(`retryPostingAttestations: ${row.transaction_id} ${row.post_publicly}`);
				// console.error(attestation);
				// console.error(srcProfile);
				postAndWriteAttestation(row.transaction_id, exports.bitcointalkAttestorAddress, attestation, srcProfile);
			});
		},
	);
}

function postAndWriteAttestation(transactionId, attestorAddress, attestationPayload, srcProfile, callback) {
	if (!callback) {
		callback = function callbackFn() {};
	}
	const mutex = require('ocore/mutex.js');
	mutex.lock([`tx-${transactionId}`], (unlock) => {
		db.query(
			`SELECT receiving_addresses.device_address, attestation_date, user_address
			FROM attestation_units
			JOIN transactions USING(transaction_id)
			JOIN receiving_addresses USING(receiving_address)
			WHERE transaction_id=?`,
			[transactionId],
			(rows) => {
				const row = rows[0];
				if (row.attestation_date) { // already posted
					callback(null, null);
					return unlock();
				}

				postAttestation(attestorAddress, attestationPayload, (err, unit) => {
					if (err) {
						callback(err);
						return unlock();
					}

					db.query(
						`UPDATE attestation_units SET attestation_unit=?, attestation_date=${db.getNow()} WHERE transaction_id=?`,
						[unit, transactionId],
						() => {
							const device = require('ocore/device.js');
							let text = [
								`Now your bitcointalk username ${srcProfile.bitcointalk_username}(${srcProfile.bitcointalk_id}) is attested, `,
								`see the attestation unit: https://explorer.obyte.org/#${unit}`,
							];

							if (srcProfile) {
								const privateProfile = {
									unit,
									payload_hash: objectHash.getBase64Hash(attestationPayload),
									src_profile: srcProfile,
								};
								const base64PrivateProfile = Buffer.from(JSON.stringify(privateProfile)).toString('base64');
								text += [
									'\n\n',
									`Click here to save the profile in your wallet: [private profile](profile:${base64PrivateProfile}). `,
									'You will be able to use it to access the services that require a proven bitcointalk profile id.',
								].join('');
							}

							text += `\n\n${texts.weHaveReferralProgram(row.user_address)}`;
							device.sendMessageToDevice(row.device_address, 'text', text);
							callback(null, unit);
							unlock();
						},
					);
				});
			},
		);
	});
}

function postAttestation(attestorAddress, payload, onDone) {
	function onError(err) {
		console.error(`attestation failed: ${err}`); // eslint-disable-line no-console
		const balances = require('ocore/balances');
		balances.readBalance(attestorAddress, (balance) => {
			console.error('balance', balance); // eslint-disable-line no-console
			notifications.notifyAdmin('attestation failed', `${err}, balance: ${JSON.stringify(balance)}`);
		});
		onDone(err);
	}

	const network = require('ocore/network.js');
	const composer = require('ocore/composer.js');
	const headlessWallet = require('headless-obyte');
	const objMessage = {
		app: 'attestation',
		payload_location: 'inline',
		payload_hash: objectHash.getBase64Hash(payload),
		payload,
	};
	const params = {
		paying_addresses: [attestorAddress],
		outputs: [{
			address: attestorAddress,
			amount: 0,
		}],
		messages: [objMessage],
		signer: headlessWallet.signer,
		callbacks: composer.getSavingCallbacks({
			ifNotEnoughFunds: onError,
			ifError: onError,
			ifOk: (objJoint) => {
				// console.error('ifOk', objJoint);
				network.broadcastJoint(objJoint);
				onDone(null, objJoint.unit.unit);
			},
		}),
	};

	if (conf.bPostTimestamp && attestorAddress === exports.bitcointalkAttestorAddress) {
		const timestamp = Date.now();
		const dataFeed = {
			timestamp,
		};
		const objTimestampMessage = {
			app: 'data_feed',
			payload_location: 'inline',
			payload_hash: objectHash.getBase64Hash(dataFeed),
			payload: dataFeed,
		};
		params.messages.push(objTimestampMessage);
	}
	composer.composeJoint(params);
}

function getUserId(profile) {
	const shortProfile = {
		bitcointalk_id: profile.bitcointalk_id,
	};
	return objectHash.getBase64Hash([shortProfile, conf.salt]);
}

function getAttestationPayloadAndSrcProfile(userAddress, bPublic, btUserData) {
	const profile = {
		bitcointalk_id: btUserData.bt_user_id,
		bitcointalk_username: btUserData.bt_user_name,
		bitcointalk_rank: btUserData.bt_user_rank,
		bitcointalk_rank_index: btUserData.bt_user_rank_index,
		bitcointalk_activity: btUserData.bt_user_activity,
		bitcointalk_posts: btUserData.bt_user_posts,
	};
	if (bPublic) {
		profile.user_id = getUserId(profile);
		const attestation = {
			address: userAddress,
			profile,
		};
		return [attestation, null];
	}
	const [publicProfile, srcProfile] = hideProfile(profile);
	const attestation = {
		address: userAddress,
		profile: publicProfile,
	};
	return [attestation, srcProfile];
}

function hideProfile(profile) {
	const composer = require('ocore/composer.js');
	const hiddenProfile = {};
	const srcProfile = {};

	for (const field in profile) {
		if (!profile.hasOwnProperty(field)) {
			continue;
		}
		const value = profile[field];
		const blinding = composer.generateBlinding();
		// console.error(`hideProfile: ${field}, ${value}, ${blinding}`);
		const hiddenValue = objectHash.getBase64Hash([value, blinding]);
		hiddenProfile[field] = hiddenValue;
		srcProfile[field] = [value, blinding];
	}
	const profileHash = objectHash.getBase64Hash(hiddenProfile);
	const profileId = getUserId(profile);
	const publicProfile = {
		profile_hash: profileHash,
		user_id: profileId,
	};
	return [publicProfile, srcProfile];
}

exports.bitcointalkAttestorAddress = null;
exports.getAttestationPayloadAndSrcProfile = getAttestationPayloadAndSrcProfile;
exports.postAndWriteAttestation = postAndWriteAttestation;
exports.retryPostingAttestations = retryPostingAttestations;
