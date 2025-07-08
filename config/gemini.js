const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: './config.env' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 컬럼명 유사도 비교 함수
async function compareColumnNames(sourceColumns, targetColumns) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
아래는 두 개의 엑셀 파일 컬럼명 목록입니다.
sourceColumns: ${JSON.stringify(sourceColumns)}
targetColumns: ${JSON.stringify(targetColumns)}
각 sourceColumns의 컬럼명에 대해 의미가 명확히 유사한 targetColumns의 컬럼명이 있을 때만 1:1로 매핑해서
{"source_column": "target_column"} 형태의 JSON만 반환하세요.
유사도가 낮거나 명확히 매칭되는 targetColumns가 없으면 value를 빈 문자열("")로 하세요.
반드시 targetColumns 목록에 있는 값만 value로 사용하세요.
예시: {"주문 번호": "", "상품명": "내용물", ...}
JSON 외의 텍스트는 절대 포함하지 마세요.
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log('Gemini 응답:', text);

        // 코드블록(```json ... ```) 제거
        let jsonText = text.trim();
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/^```json/, '').replace(/```$/, '').trim();
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```/, '').replace(/```$/, '').trim();
        }

        // JSON만 추출
        const match = jsonText.match(/{[\s\S]*}/);
        if (!match) {
            throw new Error('Gemini 응답에서 JSON을 찾을 수 없습니다.');
        }
        const mapping = JSON.parse(match[0]);
        return mapping;
    } catch (error) {
        console.error('Gemini API 오류:', error);
        throw new Error('컬럼명 매핑 중 오류가 발생했습니다.');
    }
}

module.exports = { compareColumnNames }; 