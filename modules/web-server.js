const conf = require('ocore/conf');
const db = require('ocore/db');
const validationUtils = require('ocore/validation_utils');
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const api = require('./bitcointalk-api');
const bitcointalkAttestation = require('./bitcointalk-attestation');
const notifications = require('./notifications');
const texts = require('./texts');
const receivingAddresses = require('./receiving-addresses');

function startWebServer() {
	const app = express();
	const server = require('http').Server(app);

	app.use(cookieParser());
	app.use(express.static(__dirname + '/public'));
	app.use(bodyParser.urlencoded({ extended: false }));

	app.get('/:bbAddress', async (req, res) => {
		const { params, cookies } = req;
		const { bbAddress } = params;

		if (!validationUtils.isValidAddress(bbAddress)) {
			return responseRedirect(res);
		}

		const rows = await db.query(
			`SELECT
				device_address, user_address, users.bt_user_id,
				receiving_addresses.bt_user_name
			FROM users
			LEFT JOIN receiving_addresses USING(device_address, user_address)
			WHERE user_address=?`,
			[bbAddress],
		);

		if (!rows.length) {
			return responseRedirect(res);
		}

		const device = require('ocore/device.js');
		const userInfo = rows[0];
		const { bt_user_id: btUserId, user_address: userAddress, device_address: deviceAddress } = userInfo;

		if (!btUserId) {
			device.sendMessageToDevice(deviceAddress, 'text', texts.insertBitcointalkProfileLink());
			return responseRedirect(res);
		}

		if (cookies.referrer && validationUtils.isValidAddress(cookies.referrer)) {
			db.query(
				`INSERT ${db.getIgnore()} INTO link_referrals
				(referring_user_address, device_address, type)
				VALUES(?, ?, 'cookie')`,
				[cookies.referrer, deviceAddress],
			);
		}

		async function checkUserAttestation() {
			const rows = await db.query(
				`SELECT 1
				FROM attestations
				WHERE address=? AND attestor_address=?`,
				[userAddress, bitcointalkAttestation.bitcointalkAttestorAddress],
			);
			return (rows && rows.length);
		}

		const isAttested = await checkUserAttestation();
		if (isAttested) {
			res.cookie('referrer', bbAddress, 3 * 365);
			return responseRedirect(res);
		}
		
		try {
			const profileData = await api.getProfileData(btUserId, params.bbAddress);
			if (!profileData.isLinkCorrect) {
				return device.sendMessageToDevice(deviceAddress, 'text',
					"Your bitcointalk profile doesn't contain a correct link");
			}

			receivingAddresses.readOrAssign(userInfo, (receivingAddress, postPublicly) => {
				db.query(
					`UPDATE receiving_addresses
					SET
						bt_user_name=?,
						bt_user_rank=?,
						bt_user_rank_index=?,
						bt_user_activity=?,
						bt_user_posts=?
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

				let response = `Your bitcointalk username is ${profileData.name}.\n\n`;
				const challenge = `${btUserId} ${userAddress}`;
				if (postPublicly === null) {
					response += texts.privateOrPublic();
				} else {
					response += texts.pleasePay(receivingAddress, conf.priceInBytes, userAddress, challenge);
					response += '\n\n';
					response += (postPublicly === 0)
						? texts.privateChosen()
						: texts.publicChosen(profileData.name, btUserId);
				}
				device.sendMessageToDevice(deviceAddress, 'text', response);
			});
		} catch (error) {
			console.error(error); // eslint-disable-line no-console
			notifications.notifyAdmin(
				`failed getProfileData ${btUserId}`,
				`${error}, bbAddress: ${params.bbAddress}`,
			);
			device.sendMessageToDevice(deviceAddress, 'text',
				'Failed to get your bitcointalk profile! Please, try later!');
		}

		responseRedirect(res);
	});

	server.listen(conf.webPort, () => {
		console.log(`== server started listening on ${conf.webPort} port`); // eslint-disable-line no-console
	});
}

function responseRedirect(res) {
	res.redirect('https://obyte.org');
}

exports.start = startWebServer;
