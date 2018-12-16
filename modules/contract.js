const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const reward = require('./reward');

function createContract(user_address, device_address) {
	if (!reward.distributionAddress) {
		throw Error('no distributionAddress');
	}
	const device = require('byteballcore/device.js');
	const date = new Date();
	date.setUTCHours(0, 0, 0, 0);
	const current_year = date.getUTCFullYear();
	const vesting_ts = date.setUTCFullYear(current_year + conf.contractTerm);
	const claim_back_ts = date.setUTCFullYear(current_year + conf.contractUnclaimedTerm);
	const arrDefinition = ['or', [
		['and', [
			['address', user_address],
			['in data feed', [[conf.TIMESTAMPER_ADDRESS], 'timestamp', '>', vesting_ts]]
		]],
		['and', [
			['address', reward.distributionAddress],
			['in data feed', [[conf.TIMESTAMPER_ADDRESS], 'timestamp', '>', claim_back_ts]]
		]],
	]];
	const assocSignersByPath = {
		'r.0.0': {
			address: user_address,
			member_signing_path: 'r',
			device_address: device_address
		},
		'r.1.0': {
			address: reward.distributionAddress,
			member_signing_path: 'r',
			device_address: device.getMyDeviceAddress()
		},
	};

	return new Promise((resolve) => {
		const walletDefinedByAddresses = require('byteballcore/wallet_defined_by_addresses.js');
		walletDefinedByAddresses.createNewSharedAddress(arrDefinition, assocSignersByPath, {
			ifError: (err) => {
				throw new Error(err);
			},
			ifOk: (shared_address) => {
				db.query(
					`INSERT ${db.getIgnore()} INTO contracts
					(user_address, contract_address, contract_vesting_date)
					VALUES(?, ?, ${db.getFromUnixTime(vesting_ts/1000)})`,
					[user_address, shared_address],
					() => {
						resolve([shared_address, vesting_ts]);
					},
				);
			},
		});
	});
}

function getReferrerContract(user_address, device_address) {
	return new Promise((resolve) => {
		db.query(
			`SELECT contract_address, ${db.getUnixTimestamp('contract_vesting_date')}*1000 AS contract_vesting_date_ts
			FROM contracts WHERE user_address=?`,
			[user_address],
			async (rows) => {
				if (rows.length > 0) {
					const contract_address = rows[0].contract_address;
					const contract_vesting_date_ts = rows[0].contract_vesting_date_ts;
					return resolve([contract_address, contract_vesting_date_ts]);
				}
				const [contract_address, contract_vesting_date_ts] = await createContract(user_address, device_address);
				resolve([contract_address, contract_vesting_date_ts]);
			},
		);
	});
}

module.exports = {
	createContract,
	getReferrerContract,
};
