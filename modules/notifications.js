const conf = require('ocore/conf.js');
const mail = require('ocore/mail.js');

function notifyAdmin(subject, body) {
	console.log(`notifyAdmin:\n${subject}\n${body}`); // eslint-disable-line no-console
	mail.sendmail({
		to: conf.admin_email,
		from: conf.from_email,
		subject,
		body,
	});
}

exports.notifyAdmin = notifyAdmin;
