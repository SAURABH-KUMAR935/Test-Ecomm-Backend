const nodemailer = require("nodemailer");

const sendEmail = async (to, subject, text, html = null) => {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
 
    return null;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, // true for 465, false for 587
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });

    const mailOptions = {
      from: emailUser,
      to,
      subject,
      text,
      html: html,
    };

    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (error) {
    throw error;
  }
};

module.exports = sendEmail;