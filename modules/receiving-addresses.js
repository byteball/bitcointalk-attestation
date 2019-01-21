const conf = require('byteballcore/conf');
const db = require('byteballcore/db');

/**
 * read or assign receiving address
 * @param userInfo
 * @param callback
 */
exports.readOrAssign = function readOrAssign(userInfo, callback) {
	const mutex = require('byteballcore/mutex.js');
	mutex.lock([userInfo.device_address], (unlock) => {
		db.query(
			`SELECT
				receiving_address, post_publicly, ${db.getUnixTimestamp('last_price_date')} AS price_ts
			FROM receiving_addresses 
			WHERE device_address=? AND user_address=? AND bt_user_id=?`,
			[userInfo.device_address, userInfo.user_address, userInfo.bt_user_id],
			(rows) => {
				if (rows.length > 0) {
					const row = rows[0];
					callback(row.receiving_address, row.post_publicly);
					return unlock();
				}

				const headlessWallet = require('headless-byteball');
				headlessWallet.issueNextMainAddress((receivingAddress) => {
					db.query(
						`INSERT INTO receiving_addresses 
						(device_address, user_address, bt_user_id, receiving_address, price, last_price_date) 
						VALUES(?,?,?, ?, ?,${db.getNow()})`,
						[userInfo.device_address, userInfo.user_address, userInfo.bt_user_id, receivingAddress, conf.priceInBytes],
						() => {
							callback(receivingAddress, null);
							unlock();
						},
					);
				});
			},
		);
	});
};
