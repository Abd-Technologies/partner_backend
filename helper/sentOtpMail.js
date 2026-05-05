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

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465, // Use 587 for TLS
  secure: true, // Use SSL
  auth: {
    user: process.env.EMAIL_USERNAME, // Your Gmail address
    pass: process.env.EMAIL_PASSWORD, // App password or Gmail password (if less secure apps are enabled)
  },
});

module.exports = function sentOtpMail(subject, body, email) {
  console.log("-------------"+email+"111111111")
  transporter.sendMail(
    {
      from: process.env.EMAIL_USERNAME, // Sender email address
      to: email, // Receiver email address
      subject: subject, // Email subject
      text: body, // Email body
    },
    function (error, info) {
      if (error) {
        console.error("Error sending email:", error);
      } else {
        console.log("Email sent successfully:", info.response);
      }
    }
  );
};
