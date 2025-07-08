const express = require('express');
const { pool } = require('../config/database');
const router = express.Router();

// 세션 확인 미들웨어
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    next();
};

// 기본 이메일 템플릿 생성
router.post('/init-email-template', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.user_id;
        const businessName = req.session.user.business_name;

        // 기본 템플릿 데이터
        const defaultTemplate = {
            mail_template_name: '기본 거래처 발송용',
            mail_recipient: req.session.user.email,
            mail_text: `안녕하세요. ${businessName}입니다.

업로드한 주문 발주서를 기반으로 전송해 드립니다.

첨부된 파일을 확인해 주시기 바랍니다.

감사합니다.`
        };

        // 기존 기본 템플릿 삭제
        await pool.execute(
            'DELETE FROM email_templates WHERE user_id = ? AND mail_template_name = ?',
            [userId, defaultTemplate.mail_template_name]
        );

        // 새 기본 템플릿 저장
        await pool.execute(
            'INSERT INTO email_templates (user_id, mail_template_name, mail_recipient, mail_text) VALUES (?, ?, ?, ?)',
            [userId, defaultTemplate.mail_template_name, defaultTemplate.mail_recipient, defaultTemplate.mail_text]
        );

        res.json({ success: true, message: '기본 이메일 템플릿이 생성되었습니다.' });
    } catch (error) {
        console.error('기본 이메일 템플릿 생성 오류:', error);
        res.status(500).json({ error: '기본 이메일 템플릿 생성 중 오류가 발생했습니다.' });
    }
});

// 기본 매핑 템플릿 생성
router.post('/init-mapping-template', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.user_id;

        // 기본 매핑 규칙
        const defaultMappings = [
            { source: '상품명', target: '품목명' },
            { source: '수량', target: '주문수량' },
            { source: '고객명', target: '배송받는분' },
            { source: '연락처', target: '전화번호' },
            { source: '주소', target: '배송지' }
        ];

        const templateName = '기본 매핑 규칙';

        // 기존 기본 매핑 템플릿 삭제
        await pool.execute(
            'DELETE FROM mapping_rules WHERE user_id = ? AND mapping_name = ?',
            [userId, templateName]
        );

        // 새 기본 매핑 템플릿 저장
        for (const mapping of defaultMappings) {
            await pool.execute(
                'INSERT INTO mapping_rules (user_id, mapping_name, source_column, result_column) VALUES (?, ?, ?, ?)',
                [userId, templateName, mapping.source, mapping.target]
            );
        }

        res.json({ success: true, message: '기본 매핑 템플릿이 생성되었습니다.' });
    } catch (error) {
        console.error('기본 매핑 템플릿 생성 오류:', error);
        res.status(500).json({ error: '기본 매핑 템플릿 생성 중 오류가 발생했습니다.' });
    }
});

module.exports = router; 