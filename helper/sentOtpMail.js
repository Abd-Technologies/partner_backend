// const nodemailer = require("nodemailer");
// // Defining the account for sending email
// const transporter = nodemailer.createTransport({
//   host: process.env.EMAIL_HOST,
//   port: process.env.EMAIL_PORT,
//   secure: true, // use TLS
//   auth: {
//     user: process.env.EMAIL_USERNAME,
//     pass: process.env.EMAIL_PASSWORD,
//   },
// });

// module.exports = function (subject,body,email) {
//     transporter.sendMail(
//         {
//           from: process.env.EMAIL_USERNAME, // sender address
//           to: email, // list of receivers
//           subject: subject, // Subject line
//           text: body, // plain text body
        
//         },
//         function (error, info) {
//           if(error)
//           {
//             console.log(error)
//           }
//           else
//           {
//             console.log(info)
//           }
//         });
//   };
  
 
const nodemailer = require("nodemailer");

// If the username is a gmail address, default to smtp.gmail.com unless EMAIL_HOST specifies otherwise.
const isGmail = (process.env.EMAIL_USERNAME || "").toLowerCase().endsWith("@gmail.com");
const emailHost = process.env.EMAIL_HOST && !isGmail ? process.env.EMAIL_HOST : "smtp.gmail.com";
const emailPort = parseInt(process.env.EMAIL_PORT, 10) || 465;

const transporter = nodemailer.createTransport({
  host: emailHost,
  port: emailPort,
  secure: emailPort === 465,
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});

module.exports = function sentOtpMail(subject, body, email) {
  return new Promise((resolve, reject) => {
    transporter.sendMail(
      {
        from: `"FitHer" <${process.env.EMAIL_USERNAME}>`,
        to: email,
        subject: subject,
        text: body,
        html: `
          <div style="font-family: 'Poppins', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #D8EDD4; border-radius: 16px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #163220; margin: 0 0 6px;">FitHer Password Recovery</h2>
              <p style="color: #6F8B7A; font-size: 14px; margin: 0;">Verification code for your account</p>
            </div>
            <div style="background-color: #F5FBF2; border: 1px solid #D8EDD4; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px;">
              <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #163220;">${body.match(/\b\d{4}\b/) ? body.match(/\b\d{4}\b/)[0] : body}</span>
            </div>
            <p style="color: #6F8B7A; font-size: 13px; line-height: 1.5; margin: 0 0 16px;">
              This code will expire in 10 minutes. If you did not request a password reset, you can safely ignore this email.
            </p>
            <p style="color: #9AB09A; font-size: 11px; margin: 0; text-align: center;">
              © ${new Date().getFullYear()} FitHer. All rights reserved.
            </p>
          </div>
        `,
      },
      function (error, info) {
        if (error) {
          console.error("Error sending OTP email to " + email + ":", error);
          resolve(false);
        } else {
          console.log("OTP email sent successfully to " + email + ":", info.response);
          resolve(true);
        }
      }
    );
  });
};

