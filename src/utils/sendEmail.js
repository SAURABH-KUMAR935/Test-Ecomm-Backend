const nodemailer = require("nodemailer");

let transporter;

const sendEmail = async (to, subject, text, html = null) => {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  const host = process.env.EMAIL_HOST || "smtp.gmail.com";
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = process.env.EMAIL_SECURE
    ? process.env.EMAIL_SECURE.toLowerCase() === "true"
    : port === 465;

  if (!emailUser || !emailPass) {
    return null;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("EMAIL_PORT must be a valid TCP port.");
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user: emailUser,
        pass: emailPass,
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }

  return transporter.sendMail({
    from: emailUser,
    to,
    subject,
    text,
    html,
  });
};

module.exports = sendEmail;