const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const router = express.Router();

// 로그인
router.post('/login', async (req, res) => {
    try {
        const { user_id, user_password } = req.body;
        
        if (!user_id || !user_password) {
            return res.status(400).json({ error: '회원 ID와 비밀번호를 입력해주세요.' });
        }

        const [rows] = await pool.execute(
            'SELECT * FROM users WHERE user_id = ?',
            [user_id]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: '회원 ID와 비밀번호가 일치하지 않습니다. 다시 확인하여 로그인하여 주세요' });
        }

        const user = rows[0];
        const isValidPassword = await bcrypt.compare(user_password, user.user_password);

        if (!isValidPassword) {
            return res.status(401).json({ error: '회원 ID와 비밀번호가 일치하지 않습니다. 다시 확인하여 로그인하여 주세요' });
        }

        // 세션에 사용자 정보 저장
        req.session.user = {
            id: user.id,
            user_id: user.user_id,
            name: user.name,
            email: user.email,
            business_name: user.business_name
        };

        res.json({ 
            success: true, 
            message: '로그인 성공',
            user: req.session.user
        });
    } catch (error) {
        console.error('로그인 오류:', error);
        res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
    }
});

// 회원가입
router.post('/register', async (req, res) => {
    try {
        const {
            user_id,
            user_password,
            password_confirm,
            name,
            phone,
            email,
            business_name,
            business_phone,
            business_address
        } = req.body;

        // 입력값 검증
        if (!user_id || !user_password || !name || !phone || !email || !business_name || !business_phone || !business_address) {
            return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
        }

        // 비밀번호 확인
        if (user_password !== password_confirm) {
            return res.status(400).json({ error: '비밀번호가 일치하지 않습니다.' });
        }

        // 비밀번호 규칙 검증 (8자리 이상, 영어 대소문자, 숫자, 특수문자)
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(user_password)) {
            return res.status(400).json({ error: '비밀번호는 8자리 이상 영어 대문자, 소문자, 숫자와 특수문자를 포함해야 합니다.' });
        }

        // 휴대폰 번호 검증 (010-0000-0000 형식)
        const phoneRegex = /^010-\d{4}-\d{4}$/;
        if (!phoneRegex.test(phone)) {
            return res.status(400).json({ error: '올바르지 않은 휴대폰 번호 양식입니다.' });
        }

        // 이메일 검증
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '올바르지 않은 이메일 양식입니다.' });
        }

        // 사업장 전화번호 검증
        const businessPhoneRegex = /^0\d{1,2}-\d{3,4}-\d{4}$/;
        if (!businessPhoneRegex.test(business_phone)) {
            return res.status(400).json({ error: '올바르지 않은 사업장 전화번호 양식입니다.' });
        }

        // 회원 ID 중복 체크
        const [existingUsers] = await pool.execute(
            'SELECT user_id FROM users WHERE user_id = ?',
            [user_id]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ error: '이미 등록된 회원 ID 입니다.' });
        }

        // 비밀번호 해시화
        const hashedPassword = await bcrypt.hash(user_password, 10);

        // 사용자 등록
        await pool.execute(
            'INSERT INTO users (user_id, user_password, name, phone, email, business_name, business_phone, business_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [user_id, hashedPassword, name, phone, email, business_name, business_phone, business_address]
        );

        res.json({ success: true, message: '회원가입이 완료되었습니다.' });
    } catch (error) {
        console.error('회원가입 오류:', error);
        res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' });
    }
});

// 회원 ID 중복 체크
router.post('/check-id', async (req, res) => {
    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: '회원 ID를 입력해주세요.' });
        }

        const [rows] = await pool.execute(
            'SELECT user_id FROM users WHERE user_id = ?',
            [user_id]
        );

        if (rows.length > 0) {
            return res.json({ available: false, message: '이미 등록된 회원 ID 입니다.' });
        } else {
            return res.json({ available: true, message: '사용 가능한 회원 ID입니다.' });
        }
    } catch (error) {
        console.error('ID 중복 체크 오류:', error);
        res.status(500).json({ error: 'ID 중복 체크 중 오류가 발생했습니다.' });
    }
});

// 로그아웃
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: '로그아웃 처리 중 오류가 발생했습니다.' });
        }
        res.json({ success: true, message: '로그아웃되었습니다.' });
    });
});

// 세션 확인
router.get('/session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

module.exports = router; 