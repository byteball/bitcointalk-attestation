const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const validationUtils = require('byteballcore/validation_utils');
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const api = require('./bitcointalk-api');
const notifications = require('./notifications');
const texts = require('./texts');
const receivingAddresses = require('./receiving-addresses');

function startWebServer() {
	const app = express();
	const server = require('http').Server(app);

	app.use(cookieParser());
	app.use(bodyParser.urlencoded({ extended: false }));

	app.get('/:bbAddress', (req, res) => {
		const { params, cookies } = req;
		db.query(
			`SELECT
				device_address, user_address, users.profile_id,
				receiving_addresses.profile_name
			FROM users
			LEFT JOIN receiving_addresses USING(device_address, user_address)
			WHERE user_address=?`,
			[params.bbAddress],
			(rows) => {
				if (!rows.length) {
					return responseRedirect(res);
				}

				const userInfo = rows[0];
				const { profile_id: profileId, user_address: userAddress, device_address: deviceAddress } = userInfo;
				if (cookies.referrer && validationUtils.isValidAddress(cookies.referrer)) {
					db.query(
						`INSERT ${db.getIgnore()} INTO link_referrals
						(referring_user_address, device_address, type)
						VALUES(?, ?, 'cookie')`,
						[cookies.referrer, deviceAddress],
					);
				}

				if (!userAddress) {
					device.sendMessageToDevice(deviceAddress, 'text', texts.insertMyAddress());
					return responseRedirect(res);
				}

				const device = require('byteballcore/device.js');
				api.getProfileData(profileId, params.bbAddress)
					.then((profileData) => {
						console.error('profileData', profileData);

						receivingAddresses.readOrAssign(userInfo, (receivingAddress, postPublicly) => {
							db.query(
								`UPDATE receiving_addresses
								SET
									profile_name=?,
									profile_rank=?,
									profile_rank_index=?,
									profile_activity=?,
									profile_posts=?
								WHERE receiving_address=?`,
								[
									profileData.name,
									profileData.rank,
									profileData.rankIndex,
									profileData.activity,
									profileData.posts,
									receivingAddress,
								],
							);
	
							let response = `Your bitcointalk profile name is ${profileData.name}.\n\n`;
							const challenge = `${profileId} ${userAddress}`;
							if (postPublicly === null) {
								response += texts.privateOrPublic();
							} else {
								response += texts.pleasePay(receivingAddress, conf.priceInBytes, challenge);
								response += '\n\n';
								response += (postPublicly === 0)
									? texts.privateChosen()
									: texts.publicChosen(profileData.name, profileId);
							}
							device.sendMessageToDevice(deviceAddress, 'text', response);
						});
					})
					.catch((error) => {
						console.error(error); // eslint-disable-line no-console
						notifications.notifyAdmin(`failed getProfileData ${profileId}`, `${error}, bbAddress: ${params.bbAddress}`);
						device.sendMessageToDevice(deviceAddress, 'text', 'Failed to get your bitcointalk profile! Please, try later!');
					});

				responseRedirect(res);
			},
		);
	});

	server.listen(conf.webPort, () => {
		console.log(`== server started listening on ${conf.webPort} port`); // eslint-disable-line no-console
	});
}

function responseRedirect(res) {
	res.redirect('https://byteball.org');
}

exports.start = startWebServer;
