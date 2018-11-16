const crypto = require('crypto');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const texts = require('./modules/texts');
const steemAttestation = require('./modules/bitcointalk-attestation');

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
    [referringUserAddress, steemAttestation.steemAttestorAddress],
    (rows) => {
      if (rows.length === 0) {
        console.log(`referrer ${referringUserAddress} not attested, ignoring referrer pairing code`); // eslint-disable-line no-console
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
 * scenario for responding to user requests
 * @param from_address
 * @param text
 * @param response
 */
function respond(fromAddress, text, response = '') {
  const device = require('byteballcore/device.js');
  // const mutex = require('byteballcore/mutex.js');
  readUserInfo(fromAddress, (userInfo) => {
    function checkUserAddress(onDone) {
      if (validationUtils.isValidAddress(text)) {
        userInfo.user_address = text;
        userInfo.username = null;
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

    function checkUsername(onDone) {
      if (userInfo.username) {
        return onDone();
      }
      // const link = api.getLoginURL(userInfo.unique_id);
      const link = userInfo.unique_id;
      onDone(texts.proveUsername(link));
    }

    checkUserAddress((userAddressResponse) => {
      if (userAddressResponse) {
        return device.sendMessageToDevice(fromAddress, 'text', messageNewLine(response) + userAddressResponse);
      }

      checkUsername((usernameResponse) => {
        if (usernameResponse) {
          return device.sendMessageToDevice(fromAddress, 'text', messageNewLine(response) + usernameResponse);
        }

        // readOrAssignReceivingAddress(userInfo, (receivingAddress, postPublicly) => {
        //   let price = conf.priceInBytes;
        // });
      });
    });
  });
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
    `SELECT users.user_address, receiving_addresses.username, unique_id, users.device_address 
    FROM users LEFT JOIN receiving_addresses USING(device_address, user_address) 
    WHERE device_address = ?`,
    [deviceAddress],
    (rows) => {
      if (rows.length) {
        callback(rows[0]);
      } else {
        const uniqueId = crypto.randomBytes(24).toString('base64');
        db.query(
          `INSERT ${db.getIgnore()} INTO users (device_address, unique_id) VALUES(?,?)`,
          [deviceAddress, uniqueId],
          () => {
            callback({ uniqueId, deviceAddress });
          },
        );
      }
    },
  );
}
