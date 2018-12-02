const conf = require('byteballcore/conf.js');
const mail = require('byteballcore/mail.js');

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
