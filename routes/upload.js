const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { compareColumnNames } = require('../config/gemini');
const router = express.Router();

// 세션 확인 미들웨어
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    next();
};

// 파일 업로드 설정
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv'
        ];
        
        if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('엑셀 또는 CSV 파일만 업로드 가능합니다.'), false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// 파일 업로드 처리
router.post('/files', requireAuth, upload.fields([
    { name: 'sourceFile', maxCount: 1 },
    { name: 'templateFile', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files.sourceFile || !req.files.templateFile) {
            return res.status(400).json({ error: '소스 파일과 템플릿 파일을 모두 업로드해주세요.' });
        }

        const sourceFile = req.files.sourceFile[0];
        const templateFile = req.files.templateFile[0];

        // 엑셀 파일 읽기
        const sourceWorkbook = XLSX.readFile(sourceFile.path);
        const templateWorkbook = XLSX.readFile(templateFile.path);

        const sourceSheet = sourceWorkbook.Sheets[sourceWorkbook.SheetNames[0]];
        const templateSheet = templateWorkbook.Sheets[templateWorkbook.SheetNames[0]];

        // JSON으로 변환
        const sourceData = XLSX.utils.sheet_to_json(sourceSheet, { header: 1 });
        const templateData = XLSX.utils.sheet_to_json(templateSheet, { header: 1 });

        if (sourceData.length === 0 || templateData.length === 0) {
            return res.status(400).json({ error: '파일 내용이 비어있습니다.' });
        }

        const sourceColumns = sourceData[0]; // 첫 번째 행이 컬럼명
        const templateColumns = templateData[0];

        // 첫 20행 미리보기 데이터
        const previewData = sourceData.slice(1, 21);

        res.json({
            success: true,
            message: '성공적으로 파일을 업로드하였습니다',
            sourceColumns,
            templateColumns,
            previewData,
            fullSourceData: sourceData,
            fullTemplateData: templateData,
            sourceFileName: sourceFile.originalname,
            templateFileName: templateFile.originalname
        });

    } catch (error) {
        console.error('파일 업로드 오류:', error);
        res.status(500).json({ error: '파일 업로드에 실패하였습니다.' });
    }
});

// 파일 확인 및 매핑 처리
router.post('/confirm', requireAuth, async (req, res) => {
    try {
        const { sourceColumns, templateColumns, sourceData, templateData } = req.body;
        const userId = req.session.user.user_id;

        if (!sourceColumns || !templateColumns) {
            return res.status(400).json({ error: '파일 데이터가 없습니다.' });
        }

        console.log('sourceColumns:', sourceColumns);
        console.log('templateColumns:', templateColumns);
        console.log('Gemini 요청 sourceColumns:', sourceColumns);
        console.log('Gemini 요청 templateColumns:', templateColumns);

        // Gemini API를 사용하여 컬럼 매핑
        const mapping = await compareColumnNames(sourceColumns, templateColumns);

        // 소스 데이터를 DB에 저장 (첫 행은 컬럼명, 나머지는 데이터)
        const columns = sourceColumns;
        const rows = sourceData && Array.isArray(sourceData) ? sourceData.slice(1) : [];
        
        // 데이터 크기 제한 및 최적화 (최대 10,000행)
        const maxRows = 10000;
        const limitedRows = rows.slice(0, maxRows);
        
        if (rows.length > maxRows) {
            console.warn(`데이터가 ${maxRows}행을 초과하여 ${maxRows}행만 저장됩니다.`);
        }
        
        await pool.execute(
            'INSERT INTO source_data (user_id, data) VALUES (?, ?)',
            [userId, JSON.stringify([columns, ...limitedRows])]
        );

        // 템플릿 컬럼을 DB에 저장
        await pool.execute(
            'INSERT INTO result_data (user_id, columns) VALUES (?, ?)',
            [userId, JSON.stringify(templateColumns)]
        );

        // 처리 통계 업데이트
        const today = new Date().toISOString().split('T')[0];
        await pool.execute(
            `INSERT INTO processing_stats (user_id, date, total_attempts, success_count) 
             VALUES (?, ?, 1, 1) 
             ON DUPLICATE KEY UPDATE 
             total_attempts = total_attempts + 1, 
             success_count = success_count + 1`,
            [userId, today]
        );

        res.json({
            success: true,
            mapping,
            sourceColumns,
            templateColumns
        });

    } catch (error) {
        console.error('파일 확인 및 매핑 처리 오류:', error);
        res.status(500).json({ error: '파일 확인 및 매핑 처리 중 오류가 발생했습니다.' });
    }
});

// 처리 현황 조회
router.get('/stats', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.user_id;
        const today = new Date().toISOString().split('T')[0];

        const [rows] = await pool.execute(
            'SELECT * FROM processing_stats WHERE user_id = ? AND date = ?',
            [userId, today]
        );

        let stats = {
            total_attempts: 0,
            success_count: 0,
            error_count: 0,
            last_sent_time: null,
            last_business_name: null
        };

        if (rows.length > 0) {
            stats = rows[0];
        }

        res.json(stats);
    } catch (error) {
        console.error('통계 조회 오류:', error);
        res.status(500).json({ error: '통계 조회 중 오류가 발생했습니다.' });
    }
});

module.exports = router; 