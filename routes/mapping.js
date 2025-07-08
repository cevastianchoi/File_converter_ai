const express = require('express');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const router = express.Router();

// 세션 확인 미들웨어
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    next();
};

// 매핑 규칙 저장
router.post('/save-template', requireAuth, async (req, res) => {
    try {
        const { mappingName, mappings } = req.body;
        const userId = req.session.user.user_id;

        if (!mappingName || !mappings) {
            return res.status(400).json({ error: '매핑 규칙 이름과 매핑 데이터를 입력해주세요.' });
        }

        // 기존 매핑 규칙 삭제
        await pool.execute(
            'DELETE FROM mapping_rules WHERE user_id = ? AND mapping_name = ?',
            [userId, mappingName]
        );

        // 새로운 매핑 규칙 저장 (중복 source 방지, 순서 보장)
        const uniqueMappings = [];
        const seenSources = new Set();
        for (const mapping of mappings) {
            if (!seenSources.has(mapping.source)) {
                uniqueMappings.push(mapping);
                seenSources.add(mapping.source);
            }
        }
        for (const mapping of uniqueMappings) {
            await pool.execute(
                'INSERT INTO mapping_rules (user_id, mapping_name, source_column, result_column) VALUES (?, ?, ?, ?)',
                [userId, mappingName, mapping.source, mapping.target]
            );
        }

        res.json({ success: true, message: '매핑 규칙이 저장되었습니다.' });
    } catch (error) {
        console.error('매핑 규칙 저장 오류:', error);
        res.status(500).json({ error: '매핑 규칙 저장 중 오류가 발생했습니다.' });
    }
});

// 매핑 규칙 목록 조회
router.get('/templates', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.user_id;

        const [rows] = await pool.execute(
            'SELECT DISTINCT mapping_name FROM mapping_rules WHERE user_id = ? ORDER BY mapping_name',
            [userId]
        );

        const templates = rows.map(row => row.mapping_name);
        res.json(templates);
    } catch (error) {
        console.error('매핑 규칙 목록 조회 오류:', error);
        res.status(500).json({ error: '매핑 규칙 목록 조회 중 오류가 발생했습니다.' });
    }
});

// 매핑 규칙 상세 조회
router.get('/template/:name', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.user_id;
        const mappingName = req.params.name;

        const [rows] = await pool.execute(
            'SELECT source_column, result_column FROM mapping_rules WHERE user_id = ? AND mapping_name = ? ORDER BY id ASC',
            [userId, mappingName]
        );

        const mappings = rows.map(row => ({
            source: row.source_column,
            target: row.result_column
        }));

        res.json(mappings);
    } catch (error) {
        console.error('매핑 규칙 상세 조회 오류:', error);
        res.status(500).json({ error: '매핑 규칙 상세 조회 중 오류가 발생했습니다.' });
    }
});

// 엑셀 파일 생성
router.post('/generate-excel', requireAuth, async (req, res) => {
    try {
        const { mappings } = req.body;
        const userId = req.session.user.user_id;
        const businessName = req.session.user.business_name;

        if (!mappings) {
            return res.status(400).json({ error: '매핑 데이터가 없습니다.' });
        }

        // 소스 데이터 조회 - 인덱스를 활용한 효율적인 최신 데이터 조회
        const [sourceRows] = await pool.execute(
            'SELECT data FROM source_data WHERE user_id = ? ORDER BY id DESC LIMIT 1',
            [userId]
        );

        if (sourceRows.length === 0) {
            return res.status(400).json({ error: '소스 데이터가 없습니다.' });
        }

        // sourceData 파싱 예외 처리
        let sourceData;
        try {
            sourceData = typeof sourceRows[0].data === 'string'
                ? JSON.parse(sourceRows[0].data)
                : sourceRows[0].data;
        } catch (e) {
            sourceData = [];
        }
        const sourceColumns = sourceData[0];
        const sourceRowsData = sourceData.slice(1);

        // 진단용 로그 추가
        console.log('sourceColumns:', sourceColumns);
        console.log('validMappings:', mappings);
        console.log('sourceRowsData 길이:', sourceRowsData.length);

        // 매핑된 쌍만 추출
        const validMappings = mappings.filter(m => m.source && m.target);
        console.log('유효한 매핑:', validMappings);

        // 결과 데이터 생성 - 메모리 효율성 향상
        const resultData = [];
        const resultColumns = validMappings.map(m => m.target);

        // 헤더 추가
        resultData.push(resultColumns);

        // 컬럼 인덱스 미리 계산 (성능 최적화)
        const columnIndexMap = new Map();
        validMappings.forEach(mapping => {
            const sourceIndex = sourceColumns.findIndex(col => {
                if (typeof col === 'string' && typeof mapping.source === 'string') {
                    return col.trim() === mapping.source.trim();
                }
                return col === mapping.source;
            });
            columnIndexMap.set(mapping.source, sourceIndex);
        });

        // 데이터 매핑 - 최적화된 방식
        for (let i = 0; i < sourceRowsData.length; i++) {
            const sourceRow = sourceRowsData[i];
            const resultRow = new Array(validMappings.length);
            
            for (let j = 0; j < validMappings.length; j++) {
                const mapping = validMappings[j];
                let value = '';
                
                if (Array.isArray(sourceRow)) {
                    // 배열 형태인 경우 - 미리 계산된 인덱스 사용
                    const sourceIndex = columnIndexMap.get(mapping.source);
                    if (sourceIndex >= 0 && sourceIndex < sourceRow.length) {
                        value = sourceRow[sourceIndex] || '';
                    }
                } else if (typeof sourceRow === 'object' && sourceRow !== null) {
                    // 객체 형태인 경우
                    value = sourceRow[mapping.source] || '';
                }
                
                // 빈 값 처리
                if (value === null || value === undefined) {
                    value = '';
                }
                
                resultRow[j] = value;
            }
            
            // 첫 번째 행만 로그 출력 (무한 반복 방지)
            if (i === 0) {
                console.log('첫 번째 행 매핑 결과:', resultRow);
            }
            
            resultData.push(resultRow);
        }

        // 엑셀 파일 생성 - 최적화된 방식
        const workbook = XLSX.utils.book_new();
        
        // 스트리밍 방식으로 워크시트 생성 (메모리 효율성 향상)
        const worksheet = XLSX.utils.aoa_to_sheet(resultData, {
            cellStyles: false,
            cellDates: false,
            cellNF: false,
            cellHTML: false
        });

        // 컬럼 너비 자동 조정
        const colWidths = resultColumns.map(col => ({ wch: Math.max(col.length, 10) }));
        worksheet['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(workbook, worksheet, '변환 결과');

        // 파일명 생성
        const today = new Date().toISOString().split('T')[0];
        const fileName = `변환 결과_${userId}_${today}.xlsx`;
        const filePath = path.join('uploads', fileName);

        // 최적화된 파일 저장 옵션
        const writeOptions = {
            bookType: 'xlsx',
            bookSST: false,
            type: 'file',
            compression: true
        };
        
        XLSX.writeFile(workbook, filePath, writeOptions);

        // 파일 생성 후 source_data, result_data 테이블에서 해당 user_id 데이터 삭제
        await pool.execute('DELETE FROM source_data WHERE user_id = ?', [userId]);
        await pool.execute('DELETE FROM result_data WHERE user_id = ?', [userId]);

        res.json({
            success: true,
            message: '변환 결과 파일 생성에 성공하였습니다.',
            fileName: fileName,
            filePath: filePath
        });

    } catch (error) {
        console.error('엑셀 파일 생성 오류:', error);
        res.status(500).json({ error: '엑셀 파일 생성 중 오류가 발생했습니다.' });
    }
});

// 매핑 규칙 삭제
router.delete('/template/:name', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.user_id;
        const mappingName = req.params.name;

        await pool.execute(
            'DELETE FROM mapping_rules WHERE user_id = ? AND mapping_name = ?',
            [userId, mappingName]
        );

        res.json({ success: true, message: '매핑 규칙이 삭제되었습니다.' });
    } catch (error) {
        console.error('매핑 규칙 삭제 오류:', error);
        res.status(500).json({ error: '매핑 규칙 삭제 중 오류가 발생했습니다.' });
    }
});

module.exports = router; 