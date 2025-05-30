# User Dossier System Documentation

## Overview

The User Dossier System is a core feature of the Helix AI that creates persistent, evolving profiles for each user. These dossiers capture personality insights, relationships, preferences, and conversational context to enable more personalized and meaningful interactions over time.

## What is a User Dossier?

A user dossier is a structured markdown document that serves as the AI's "memory" of each individual user. It contains:

- **Relationships**: People mentioned in conversations and their relationship to the user
- **Preferences**: Discovered interests, personality traits, and behavioral patterns  
- **Context & Background**: Additional contextual information that helps understand the user
- **Personality Insights**: AI-generated observations about communication style and behavior
- **Conversation Summaries**: Key themes and topics from recent conversations
- **Interests & Hobbies**: Activities and topics the user enjoys
- **Goals & Aspirations**: Personal or professional objectives mentioned by the user

## Architecture

The dossier system consists of several key components:

### Core Components

1. **Dossier Creation & Management** (`userDossier.ts`)
   - Creates new dossiers with YAML frontmatter
   - Updates specific sections with new information
   - Handles AI function calls for intelligent updates

2. **Persistence Layer** (`dossierPersistence.ts`)
   - Manages OpenAI file storage
   - Handles vector store integration for semantic search
   - Manages file lifecycle (create, update, delete)

3. **Enhanced OpenAI Integration** (`openai.ts`)
   - Single `openAiResponsesRequest` function with automatic file search integration
   - Automatically enables file search when vector store is configured via `file_search` parameter
   - Extracts and processes file_search_call.results from responses
   - Seamlessly combines web search, file search, and function calls in one API

## Data Flow

### Dossier Creation
```
User message → ensureUserDossier() → createUserDossier() → persistDossierUpdate() → Firebase mapping
```

### Information Updates
```
AI conversation → Function calls → handleDossierFunctionCall() → updateDossierSection() → persistDossierUpdate()
```

### Information Retrieval
```
Incoming message → File search via openAiResponsesRequest → Relevant insights during inference
```

## File Structure

Each dossier is stored as a markdown file with YAML frontmatter:

```yaml
---
userId: ""
name: ""
---
```

## Relationships
<!-- Format: **Name** (relationship type): Description -->

## Preferences
<!-- Format: **[Category Name]**: Short placeholder description (confidence: [level]) -->

## Context & Background
<!-- Format: key: example description -->

## Personality Insights
<!-- Format: Freeform text with bullet points if needed -->

## Conversation Summaries
<!-- Format: Bullet points summarizing key discussion topics -->

## Interests & Hobbies
<!-- Format: Bullet points or a list of topics/activities -->

## Goals & Aspirations
<!-- Format: Bullet points outlining personal or professional objectives -->

## AI Function Integration

The system uses OpenAI function calling to intelligently categorize and store information:

### Available Functions

1. **`update_user_relationship`**
   - Records people mentioned in conversations
   - Parameters: name, relationship, context
   - Example: Friend mentions their sister → Records in Relationships section

2. **`update_user_preferences`**
   - Captures preferences, interests, or personality traits
   - Parameters: category, insight, confidence level
   - Routes to appropriate section (preferences, interests, or goals)

3. **`update_user_context`**
   - Records diary-like reflections on conversation mood and dynamics
   - Parameters: context, timeframe
   - Focuses on emotional tone rather than literal transcripts

## Storage & Search

### OpenAI Integration
- Each dossier is stored as an OpenAI file for AI Assistant access
- Automatic cleanup of old files when content is updated

### Vector Store Search
- Dossiers are indexed in OpenAI's vector store for semantic search
- Utilizes OpenAI's native `file_search` tool for enhanced context retrieval
- Automatically enabled when vector store is configured
- AI can directly search through user dossiers during conversation
- Results are included in responses via `file_search_call.results`
- Provides more seamless integration than manual vector store queries
- Falls back to text-based search if vector store unavailable

### Firebase Mapping
```javascript
users/{userId}/dossier: {
  userId: string,
  fileId: string,           // OpenAI file ID
  vectorStoreFileId: string // Vector store file ID
}
```

## Usage in Conversations

### Context Retrieval
When a user sends a message, the system:
1. Uses file search via openAiResponsesRequest to find relevant dossier content
2. Retrieves relevant insights from previous conversations
3. Includes these insights in the AI's system prompt
4. AI uses this context to provide more personalized responses

### Information Capture
During conversations, the AI:
1. Identifies new information about the user
2. Makes function calls to update appropriate dossier sections
3. Updates are processed **after the response is sent to the user** to ensure optimal response time
4. File and vector store are updated automatically in the background

## Privacy & Security

- Firebase security rules control access to mappings
- OpenAI files are private to the organization
- Personal information is allowed to be shared between users since this is AI's memory

## Benefits

1. **Personalization**: AI remembers user preferences and context
2. **Relationship Awareness**: Understands user's social connections
3. **Conversation Continuity**: Maintains context across sessions
4. **Learning**: System gets smarter about users over time
5. **Natural Interaction**: Reduces need to re-explain background

## Error Handling

The system is designed to be resilient:
- Graceful degradation when dossier operations fail
- Fallback search when vector store unavailable
- Conversation continues even if dossier updates fail
- Comprehensive logging for troubleshooting

## Future Enhancements

- **Smart Summarization**: Automatic consolidation of older entries
- **Cross-Platform Sync**: Better handling of same user across platforms
- **Analytics**: Insights into dossier growth and usage patterns
- **Privacy Controls**: User-facing options to view/edit their dossier
- **Advanced Search**: More sophisticated semantic search capabilities

## Example Scenarios

### New User
1. User sends first message
2. System calls `ensureUserDossier()` 
3. Creates basic dossier with just frontmatter
4. AI conversation begins with empty context

### Returning User
1. User sends message about weekend plans
2. System searches dossier for relevant context
3. Finds user enjoys rock climbing (from Interests section)
4. AI suggests climbing spots based on this knowledge

### Information Update
1. User mentions their new job
2. AI calls `update_user_context` function
3. Context section updated with employment information
4. Future conversations reference this context

This system enables the Helix AI to build genuine relationships with users by remembering what matters to them, creating a more human-like conversational experience.
