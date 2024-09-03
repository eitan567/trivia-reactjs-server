const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./trivia.db');

function runAsyncQuery(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getAsyncQuery(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function generateTables() {
    try {
        await runAsyncQuery(db, `CREATE TABLE IF NOT EXISTS Topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )`);

        await runAsyncQuery(db, `CREATE TABLE IF NOT EXISTS Subtopics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER,
            name TEXT NOT NULL,
            FOREIGN KEY (topic_id) REFERENCES Topics(id)
        )`);

        await runAsyncQuery(db, `CREATE TABLE IF NOT EXISTS Questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subtopic_id INTEGER,
            question_text TEXT NOT NULL,
            difficulty_level INTEGER NOT NULL,
            FOREIGN KEY (subtopic_id) REFERENCES Subtopics(id)
        )`);

        await runAsyncQuery(db, `CREATE TABLE IF NOT EXISTS Answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER,
            answer_text TEXT NOT NULL,
            is_correct BOOLEAN NOT NULL,
            FOREIGN KEY (question_id) REFERENCES Questions(id)
        )`);

        await runAsyncQuery(db, `CREATE TABLE IF NOT EXISTS Players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL,
            date_of_birth DATE NOT NULL,
            score INTEGER DEFAULT 0,
            rank TEXT,
            avatar TEXT
        )`);

        await runAsyncQuery(db, `CREATE TABLE IF NOT EXISTS Settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL,
            value TEXT NOT NULL
        )`);

        await runAsyncQuery(db, `CREATE VIEW IF NOT EXISTS Leaderboard AS
            SELECT 
                id AS player_id,
                full_name,
                email,
                rank,
                avatar,
                score AS total_score
            FROM 
                Players
            ORDER BY 
                total_score DESC;
        `);

        // הוספת נושאים ותתי נושאים
        const topics = [
            'מדע וטכנולוגיה',
            'גיאוגרפיה',
            'היסטוריה',
            'ספרות ושירה',
            'תרבות כללית',
            'חיות וטבע',
            'ספורט',
            'מתמטיקה',
            'מזון ובישול',
            'דת ומסורת'
        ];

        const subtopics = {
            'מדע וטכנולוגיה': ['פיזיקה', 'כימיה', 'ביולוגיה', 'המצאות מדעיות וטכנולוגיות'],
            'גיאוגרפיה': ['מדינות וערים', 'נהרות', 'הרים', 'גבולות'],
            'היסטוריה': ['אירועים היסטוריים', 'דמויות היסטוריות', 'תקופות', 'אימפריות'],
            'ספרות ושירה': ['ספרים וסופרים', 'משוררים', 'דמויות ספרותיות', 'מחזות'],
            'תרבות כללית': ['מוזיקה', 'אמנות', 'קולנוע', 'טלוויזיה', 'תיאטרון'],
            'חיות וטבע': ['מיני חיות', 'צמחים', 'אקולוגיה', 'מערכות אקולוגיות'],
            'ספורט': ['סוגי ספורט', 'שחקנים', 'קבוצות', 'תחרויות ספורט'],
            'מתמטיקה': ['חישובים', 'נוסחאות', 'גיאומטריה', 'סטטיסטיקה'],
            'מזון ובישול': ['מאכלים', 'מתכונים', 'מטבחים', 'תזונה'],
            'דת ומסורת': ['דתות', 'חגי ישראל', 'מנהגים', 'סמלים דתיים']
        };

        for (const topic of topics) {
            const { lastID: topicId } = await runAsyncQuery(db, `INSERT INTO Topics (name) VALUES (?)`, [topic]);

            for (const subtopic of subtopics[topic]) {
                await runAsyncQuery(db, `INSERT INTO Subtopics (topic_id, name) VALUES (?, ?)`, [topicId, subtopic]);
            }
        }

        // הגדרת הגדרות משחק ראשוניות
        await runAsyncQuery(db, 
            `INSERT OR REPLACE INTO Settings (key, value) VALUES ('questionsPerGame', '10')`
        );
        await runAsyncQuery(db, 
            `INSERT OR REPLACE INTO Settings (key, value) VALUES ('timePerQuestion', '10000')`
        );
        await runAsyncQuery(db, 
            `INSERT OR REPLACE INTO Settings (key, value) VALUES ('maxPlayersPerGame', '4')`
        );

        // טעינת השאלות מקובץ JSON למסד הנתונים
        const questions = require('./questions.json');

        for (const q of questions) {
            const row = await getAsyncQuery(db, 
                `SELECT Subtopics.id AS subtopic_id, Topics.id AS topic_id 
                FROM Subtopics 
                JOIN Topics ON Subtopics.topic_id = Topics.id 
                WHERE Topics.name = ? AND Subtopics.name = ?`, 
                [q.topic, q.subtopic]
            );

            if (row) {
                const { subtopic_id } = row;
                const { lastID: questionId } = await runAsyncQuery(db, 
                    `INSERT INTO Questions (subtopic_id, question_text, difficulty_level) VALUES (?, ?, ?)`,
                    [subtopic_id, q.question, 5]
                );

                for (const [idx, answer] of q.answers.entries()) {
                    await runAsyncQuery(db, 
                        `INSERT INTO Answers (question_id, answer_text, is_correct) VALUES (?, ?, ?)`,
                        [questionId, answer, idx === q.correctAnswer]
                    );
                }
            } else {
                console.log(`Could not find topic/subtopic: ${q.topic}/${q.subtopic}`);
            }
        }

    } catch (error) {
        console.error("Error during database setup:", error);
    } finally {
        db.close();
    }
}

generateTables();
