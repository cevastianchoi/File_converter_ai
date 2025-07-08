const mysql = require('mysql2/promise');
require('dotenv').config({ path: '../.env' });

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'runmoa_db',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // MySQL 성능 최적화 설정
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    charset: 'utf8mb4'
};

const pool = mysql.createPool(dbConfig);

// 데이터베이스 초기화 함수
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // users 테이블 생성
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(50) UNIQUE NOT NULL,
                user_password VARCHAR(255) NOT NULL,
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                email VARCHAR(100) NOT NULL,
                business_name VARCHAR(100) NOT NULL,
                business_phone VARCHAR(20) NOT NULL,
                business_address TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // source_data 테이블 생성
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS source_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(50) NOT NULL,
                data JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at)
            )
        `);

        // result_data 테이블 생성
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS result_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(50) NOT NULL,
                columns JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // mapping_rules 테이블 생성
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS mapping_rules (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(50) NOT NULL,
                mapping_name VARCHAR(100) NOT NULL,
                source_column VARCHAR(100),
                result_column VARCHAR(100),
                created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // email_templates 테이블 생성
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS email_templates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(50) NOT NULL,
                mail_template_name VARCHAR(100) NOT NULL,
                mail_recipient VARCHAR(100),
                mail_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // processing_stats 테이블 생성
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS processing_stats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(50) NOT NULL,
                date DATE NOT NULL,
                total_attempts INT DEFAULT 0,
                success_count INT DEFAULT 0,
                error_count INT DEFAULT 0,
                last_sent_time TIMESTAMP NULL,
                last_business_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_date (user_id, date)
            )
        `);

        connection.release();
        console.log('데이터베이스 테이블이 성공적으로 초기화되었습니다.');
    } catch (error) {
        console.error('데이터베이스 초기화 오류:', error);
        throw error;
    }
}

module.exports = { pool, initializeDatabase }; 