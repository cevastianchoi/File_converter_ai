const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { sendEmail, createEmailTemplate } = require('../config/email');
const router = express.Router();

// 세션 확인 미들웨어
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    next();
};

// 이메일 전송
router.post('/send', requireAuth, async (req, res) => {
    try {
        const { 
            templateName, 
            recipient, 
            subject, 
            body, 
            attachmentPath, 
            sendOption,
            scheduledTime 
        } = req.body;

        const userId = req.session.user.user_id;
        const userEmail = req.session.user.email;

        // 첨부 파일 확인
        if (!attachmentPath || !fs.existsSync(attachmentPath)) {
            return res.status(400).json({ error: '첨부 파일을 찾을 수 없습니다.' });
        }

        // 이메일 데이터 준비
        const emailData = {
            to: recipient || userEmail,
            subject: subject,
            html: body,
            attachments: [{
                filename: path.basename(attachmentPath),
                path: attachmentPath
            }]
        };

        // 전송 옵션에 따른 처리
        if (sendOption === 'scheduled' && scheduledTime) {
            // 예약 전송 로직 (실제 구현에서는 큐 시스템 사용 권장)
            const scheduledDate = new Date(scheduledTime);
            const now = new Date();
            
            if (scheduledDate <= now) {
                return res.status(400).json({ error: '예약 시간은 현재 시간보다 이후여야 합니다.' });
            }

            // 간단한 예약 전송 (실제로는 Redis나 데이터베이스 기반 스케줄러 사용)
            setTimeout(async () => {
                try {
                    await sendEmail(emailData);
                    console.log('예약 이메일 전송 완료');
                } catch (error) {
                    console.error('예약 이메일 전송 실패:', error);
                }
            }, scheduledDate.getTime() - now.getTime());

            res.json({ 
                success: true, 
                message: '이메일이 예약되었습니다.',
                scheduledTime: scheduledTime
            });
        } else {
            // 즉시 전송
            const result = await sendEmail(emailData);

            if (result.success) {
                // 전송 성공 시 통계 업데이트
                const today = new Date().toISOString().split('T')[0];
                await pool.execute(
                    `UPDATE processing_stats 
                     SET last_sent_time = NOW(), last_business_name = ? 
                     WHERE user_id = ? AND date = ?`,
                    [req.session.user.business_name, userId, today]
                );

                res.json({ 
                    success: true, 
                    message: '이메일 전송에 성공 했습니다.',
                    messageId: result.messageId
                });
            } else {
                throw new Error('이메일 전송 실패');
            }
        }

    } catch (error) {
        console.error('이메일 전송 오류:', error);
        
        // 전송 실패 시 데이터 정리
        try {
            const userId = req.session.user.user_id;
            await pool.execute('DELETE FROM source_data WHERE user_id = ?', [userId]);
            await pool.execute('DELETE FROM result_data WHERE user_id = ?', [userId]);
        } catch (cleanupError) {
            console.error('데이터 정리 오류:', cleanupError);
        }

        res.status(500).json({ error: '메일 전송에 실패하였습니다.' });
    }
});

// 이메일 템플릿 생성
router.post('/template', requireAuth, async (req, res) => {
    try {
        const { templateName, recipient, body } = req.body;
        const userId = req.session.user.user_id;

        if (!templateName) {
            return res.status(400).json({ error: '템플릿 이름을 입력해주세요.' });
        }

        // 기존 템플릿 삭제
        await pool.execute(
            'DELETE FROM email_templates WHERE user_id = ? AND mail_template_name = ?',
            [userId, templateName]
        );

        // 새 템플릿 저장
        await pool.execute(
            'INSERT INTO email_templates (user_id, mail_template_name, mail_recipient, mail_text) VALUES (?, ?, ?, ?)',
            [userId, templateName, recipient, body]
        );

        res.json({ success: true, message: '이메일 템플릿이 저장되었습니다.' });
    } catch (error) {
        console.error('이메일 템플릿 저장 오류:', error);
        res.status(500).json({ error: '이메일 템플릿 저장 중 오류가 발생했습니다.' });
    }
});

// 이메일 템플릿 목록 조회
router.get('/templates', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.user_id;

        const [rows] = await pool.execute(
            'SELECT DISTINCT mail_template_name FROM email_templates WHERE user_id = ? ORDER BY mail_template_name',
            [userId]
        );

        const templates = rows.map(row => row.mail_template_name);
        res.json(templates);
    } catch (error) {
        console.error('이메일 템플릿 목록 조회 오류:', error);
        res.status(500).json({ error: '이메일 템플릿 목록 조회 중 오류가 발생했습니다.' });
    }
});

// 이메일 템플릿 상세 조회
router.get('/template/:name', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.user_id;
        const templateName = req.params.name;

        const [rows] = await pool.execute(
            'SELECT mail_recipient, mail_text FROM email_templates WHERE user_id = ? AND mail_template_name = ? LIMIT 1',
            [userId, templateName]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
        }

        res.json({
            recipient: rows[0].mail_recipient,
            body: rows[0].mail_text
        });
    } catch (error) {
        console.error('이메일 템플릿 상세 조회 오류:', error);
        res.status(500).json({ error: '이메일 템플릿 상세 조회 중 오류가 발생했습니다.' });
    }
});

// 첨부 파일 미리보기
router.get('/preview/:filename', requireAuth, (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join('uploads', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
        }

        res.download(filePath, filename);
    } catch (error) {
        console.error('파일 미리보기 오류:', error);
        res.status(500).json({ error: '파일 미리보기 중 오류가 발생했습니다.' });
    }
});

module.exports = router; 