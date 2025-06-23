# Susival Chatbot with Conversation Context

A BigQuery-powered chatbot that uses Google's Gemini AI to convert natural language questions into SQL queries and provides conversational context for follow-up questions.

## Features

- **Conversation Context**: Maintains conversation history to provide context for follow-up questions
- **SQL Generation**: Converts natural language to BigQuery SQL queries
- **Data Analysis**: Executes queries and formats results in natural language
- **Conversation Management**: Clear history and retrieve conversation data

## API Endpoints

### 1. Chat Endpoint

**POST** `/chatBot`

Send a message and get a response with conversation context.

**Request Body:**
```json
{
  "message": {
    "text": "How much did we sell last month?"
  },
  "conversationId": "user123" // Optional, defaults to "default"
}
```

**Response:**
```json
{
  "text": "Based on the data, your total sales for last month were $45,230.",
  "conversationId": "user123"
}
```

### 2. Clear Conversation History

**POST** `/clearConversation`

Clear the conversation history for a specific conversation ID.

**Request Body:**
```json
{
  "conversationId": "user123" // Optional, defaults to "default"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation history cleared for ID: user123",
  "conversationId": "user123"
}
```

### 3. Get Conversation History

**GET** `/getConversationHistory?conversationId=user123`

Retrieve the conversation history for a specific conversation ID.

**Response:**
```json
{
  "conversationId": "user123",
  "history": [
    {
      "role": "user",
      "content": "How much did we sell last month?",
      "timestamp": "2024-01-15T10:30:00.000Z"
    },
    {
      "role": "assistant",
      "content": "Based on the data, your total sales for last month were $45,230.",
      "timestamp": "2024-01-15T10:30:05.000Z"
    }
  ],
  "messageCount": 2
}
```

## Conversation Context Features

### How It Works

1. **Message Storage**: Each user message and bot response is stored with a timestamp
2. **Context Injection**: Previous conversation messages are included in the prompt sent to Gemini
3. **Follow-up Support**: The AI can understand references to previous results and questions
4. **Memory Management**: Only the last 10 messages are kept to prevent context overflow

### Example Conversation Flow

```
User: "What were our sales last month?"
Bot: "Your total sales for last month were $45,230."

User: "How does that compare to the previous month?"
Bot: "Compared to the previous month, your sales increased by 12% from $40,380 to $45,230."
```

The bot understands that "that" refers to the previous month's sales figure and can provide comparative analysis.

## Environment Variables

Make sure to set these environment variables:

- `PROJECT_ID`: Your Google Cloud project ID
- `LOCATION`: Your BigQuery location (e.g., "US")
- `GEMINI_MODEL`: The Gemini model to use (e.g., "gemini-1.5-pro")
- `AGENT_NAME`: The name of your chatbot assistant

## Table Schema Configuration

The chatbot uses the `table_schema.json` file to understand your BigQuery table structure. Make sure this file is properly configured with your table schemas.

## Production Considerations

- **Storage**: The current implementation uses in-memory storage. For production, consider using a database like Firestore or BigQuery to persist conversation history
- **Security**: Implement proper authentication and authorization for conversation access
- **Rate Limiting**: Add rate limiting to prevent abuse
- **Monitoring**: Add logging and monitoring for conversation quality and performance

## Installation

```bash
npm install
```

## Usage

```bash
node index.js
```

The chatbot will be available at the configured endpoint and will maintain conversation context for each unique conversation ID. 