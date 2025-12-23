import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();
const { EMAIL_USER, EMAIL_PASS, EMAIL_TO } = process.env;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

async function sendEmail(subject, text) {
  const info = await transporter.sendMail({
    from: `"Workday Grades" <${EMAIL_USER}>`,
    to: EMAIL_TO,
    subject,
    text,
  });
  console.log("Email sent:", info.messageId);
}

export { sendEmail };
