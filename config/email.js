const nodemailer = require('nodemailer');
require('dotenv').config({ path: './config.env' });

// SMTP 트랜스포터 생성
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// 이메일 전송 함수
async function sendEmail(emailData) {
    try {
        const { to, subject, text, html, attachments } = emailData;
        
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: to,
            subject: subject,
            text: text,
            html: html,
            attachments: attachments || []
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('이메일 전송 성공:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('이메일 전송 실패:', error);
        throw new Error('이메일 전송에 실패했습니다.');
    }
}

// 이메일 템플릿 생성 함수
function createEmailTemplate(templateName, data) {
    const templates = {
        '기본 거래처 발송용': {
            subject: `[발주서] ${data.date} ${data.sourceFileName} 주문`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>안녕하세요.</h2>
                    <p>업로드한 주문 발주서를 기반으로 전송해 드립니다.</p>
                    <br>
                    <p>첨부된 파일을 확인해 주시기 바랍니다.</p>
                    <br>
                    <p>감사합니다.</p>
                </div>
            `
        }
    };

    return templates[templateName] || templates['기본 거래처 발송용'];
}

module.exports = { sendEmail, createEmailTemplate }; 