const {BigQuery} = require('@google-cloud/bigquery');
const {GoogleGenAI} = require('@google/genai');
const fs = require('fs');
const path = require('path');

const bigquery = new BigQuery();

const { LOCATION, PROJECT_ID, GEMINI_MODEL, AGENT_NAME } = process.env;

const tableSchemaPath = path.join(process.cwd(), 'table_schema.json');
const allTableSchemas = JSON.parse(fs.readFileSync(tableSchemaPath, 'utf8'));

// In-memory conversation storage (in production, consider using a database)
const conversationHistory = new Map();

const ai = new GoogleGenAI({
    vertexai: true,
    project: PROJECT_ID,
    location: LOCATION,
});

exports.chatBot = async (req, res) => {
  try {
    const messageText = req.body.message.text;
    const conversationId = req.body.conversationId || 'default';
    
    const replyText = await processMessage(messageText, conversationId, bigquery, ai);
    res.json({ text: replyText, conversationId });
  } catch (error) {
    console.error('Error in chatBot:', error);
    res.status(500).json({ text: `An error occurred while processing your request: ${error.message}` });
  }
};

// Function to get conversation history
function getConversationHistory(conversationId) {
  return conversationHistory.get(conversationId) || [];
}

// Function to add message to conversation history
function addToConversationHistory(conversationId, role, content) {
  if (!conversationHistory.has(conversationId)) {
    conversationHistory.set(conversationId, []);
  }
  
  const history = conversationHistory.get(conversationId);
  history.push({ role, content, timestamp: new Date().toISOString() });
  
  // Keep only last 10 messages to prevent context from getting too large
  if (history.length > 10) {
    history.splice(0, history.length - 10);
  }
  
  conversationHistory.set(conversationId, history);
}

// Function to clear conversation history
function clearConversationHistory(conversationId) {
  conversationHistory.delete(conversationId);
}

// Function to get all conversation IDs
function getAllConversationIds() {
  return Array.from(conversationHistory.keys());
}

async function processMessage(messageText, conversationId) {
    console.log(`Message Received: ${messageText}`);
    console.log(`Conversation ID: ${conversationId}`);

    // Add user message to history
    addToConversationHistory(conversationId, 'user', messageText);

    const geminiPrompt = buildPrompt(messageText, conversationId);
    const sqlQuery = await getSQLFromGemini(geminiPrompt);

    console.log(sqlQuery);
    
    const bigQueryResult = await runBigQuery(sqlQuery);
    
    const formattedResponse = await formatBigQueryResult(messageText, bigQueryResult);
    
    // Add assistant response to history
    addToConversationHistory(conversationId, 'assistant', formattedResponse);
    
    return formattedResponse;
}

const systemPrompt = `You are a data expert assistant called ${AGENT_NAME}. Your job is to convert user questions written in natural language into SQL queries for BigQuery. You must follow the rules and use the provided table schemas to generate the SQL queries. You must select the most appropriate table based on the user\'s question.`;

function buildPrompt(messageText, conversationId) {
  const conversationHistory = getConversationHistory(conversationId);
  
  const allSchemasString = allTableSchemas.map(table => {
    const schemaString = table.schema.map(col => `*   ${col.name} (${col.type})`).join('\n    ');
    return `
    Table: \`${PROJECT_ID}.${table.datasetName}.${table.tableName}\`

    Table schema:
    ${schemaString}
    `;
  }).join('\n');

  // Build conversation context
  let conversationContext = '';
  if (conversationHistory.length > 0) {
    conversationContext = `
    ### Previous Conversation Context:
    ${conversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')}
    
    ---
    `;
  }

  return `
    You must use one of the following tables as the data source:
    ${allSchemasString}

    ${conversationContext}

    ### Rules:

    1. Return only the SQL code, without any explanations or additional text.
    2. The query must be 100% compatible with BigQuery Standard SQL.
    3. If the user's question is unclear or lacks context, generate the most generic SQL that still makes sense, selecting the most relevant table.
    4. Always limit the results to a maximum of 100 rows using \`LIMIT 100\` if there is no natural filter.
    5. Always include the fully qualified table name (e.g., \`project.dataset.table\`) in the FROM clause.
    6. Consider the conversation context when interpreting the current question. If the user refers to previous results or asks follow-up questions, use that context to build more relevant queries.

    ### Examples:

    #### Example 1 (using monthly_sales):

    **Question:** "How much did we sell in total last month?"

    **SQL Answer:**

    \`\`\`sql
    SELECT SUM(total_sale) AS total_sales
    FROM \`project_id.my_dataset.monthly_sales\`
    WHERE EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE())
    AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH));
    \`\`\`

    ---

    #### Example 2 (using monthly_sales):

    **Question:** "Show me sales by region for this year."

    **SQL Answer:**

    \`\`\`sql
    SELECT region, SUM(total_sale) AS total_sales
    FROM \`project_id.my_dataset.monthly_sales\`
    WHERE EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE())
    GROUP BY region;
    \`\`\`

    ---

    #### Example 3 (using customer_data):

    **Question:** "List all customers registered in 2023."

    **SQL Answer:**

    \`\`\`sql
    SELECT customer_id, name, email
    FROM \`project_id.my_dataset.customer_data\`
    WHERE EXTRACT(YEAR FROM registration_date) = 2023
    LIMIT 100;
    \`\`\`

    ---

    Now, convert the following question into BigQuery SQL following the same format:

    **Question:** "${messageText}"

    **SQL Answer:**
`;
}

async function getSQLFromGemini(promptText) {
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: promptText,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2,
      maxOutputTokens: 1024,
    }
  });
  const geminiText = response.candidates[0].content.parts[0].text;
  console.log('Raw Gemini Response:', geminiText);
  const sqlMatch = geminiText.match(/```sql\n([\s\S]*?)```/i);
  return sqlMatch ? sqlMatch[1].trim() : geminiText.trim();
}

async function runBigQuery(sql) {
  const [rows] = await bigquery.query({ query: sql });
  return rows;
}

async function formatBigQueryResult(question, rows) {
  const prompt = `
  You are ${AGENT_NAME}, a data analysis assistant.

  Your task is to interpret and translate the result of an SQL query executed in BigQuery into clear natural language.

  You will receive two inputs:

  1. The original question asked by the user in natural language.
  2. The result of the SQL query, provided as JSON (with rows and columns).

  Your response must:

  - Be clear and concise.
  - Answer the user's original question directly, based on the data in the SQL result.
  - Avoid technical language or SQL references.
  - Do not explain how the SQL query was built, only interpret the result.

  ---

  ***USER'S ORIGINAL QUESTION***
  ${question}

  ***SQL QUERY RESULT (JSON)***
  ${JSON.stringify(rows)}
`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt
  });
  return response.candidates[0].content.parts[0].text;
}

// New endpoint to clear conversation history
exports.clearConversation = async (req, res) => {
  try {
    const conversationId = req.body.conversationId || 'default';
    clearConversationHistory(conversationId);
    res.json({ 
      success: true, 
      message: `Conversation history cleared for ID: ${conversationId}`,
      conversationId 
    });
  } catch (error) {
    console.error('Error clearing conversation:', error);
    res.status(500).json({ 
      success: false, 
      error: `An error occurred while clearing conversation: ${error.message}` 
    });
  }
};

// New endpoint to get conversation history
exports.getConversationHistory = async (req, res) => {
  try {
    const conversationId = req.query.conversationId || 'default';
    const history = getConversationHistory(conversationId);
    res.json({ 
      conversationId, 
      history,
      messageCount: history.length 
    });
  } catch (error) {
    console.error('Error getting conversation history:', error);
    res.status(500).json({ 
      success: false, 
      error: `An error occurred while getting conversation history: ${error.message}` 
    });
  }
};
