exports.port = null;
// exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';

// TOR is recommended. If you don't run TOR, please comment the next two lines
// exports.socksHost = '127.0.0.1';
// exports.socksPort = 9050;

exports.hub = 'byteball.org/bb';
exports.deviceName = 'Steem attestation bot';
exports.permanent_pairing_secret = '0000';
exports.control_addresses = [''];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.bIgnoreUnpairRequests = true;
exports.bSingleAddress = false;
exports.bStaticChangeAddress = true;
exports.KEYS_FILENAME = 'keys.json';

// emails
exports.admin_email = '';
exports.from_email = '';

// witnessing
exports.bRunWitness = false;
exports.THRESHOLD_DISTANCE = 20;
exports.MIN_AVAILABLE_WITNESSINGS = 100;

exports.priceInBytes = 49000;
exports.bAcceptUnconfirmedPayments = true;

exports.MAX_REFERRAL_DEPTH = 5;

// Ranks: Brand New, Newbie, Jr. Member, Member, Full Member, Sr. Member, Hero Member, Legendary
// Sub-Ranks: Donator, VIP
// Staff Ranks: Staff, Moderator, Global Moderator, Administrator, Founder
exports.listRankRewardsInUsd = {
  'Brand New': 0.025,
  'Newbie': 0.05,
  'Jr. Member': 0.075,
  'Member': 0.1,
  'Full Member': 0.125,
  'Sr. Member': 0.15,
  'Hero Member': 0.175,
  'Legendary': 0.175,
  'Donator': 0.2,
  'VIP': 0.225,
  'Staff': 0.25,
  'Moderator': 0.275,
  'Global Moderator': 0.3,
  'Administrator': 0.4,
  'Founder': 0.5,
};

exports.signingRewardShare = 1;

exports.rewardContractShare = 0.5;
exports.referralRewardContractShare = 0.75;

exports.contractTerm = 1; // years
exports.contractUnclaimedTerm = 2; // years

// isTestnet ? 'OPNUXBRSSQQGHKQNEPD2GLWQYEUY5XLD' : 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT'
exports.TIMESTAMPER_ADDRESS = 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT';

exports.admin = {
  isActive: true,
  deviceAddresses: [],
};

exports.webSiteUrl = 'https://bitcointalk-byteball.org';

exports.webPort = 8080;
