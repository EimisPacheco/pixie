# Pixie - Technical Architecture

## Overview

Pixie is a Chrome extension that enables voice-controlled development on bolt.new using ElevenLabs Conversational AI and Google Gemini.

## Core Components

### 1. Content Script (`content.js`)

The content script runs on bolt.new pages and handles:

- **UI Injection**: Adds microphone button and voice controls to the page
- **Audio Capture**: Records user's voice using MediaRecorder API
- **Tool Execution**: Implements client-side tools called by the ElevenLabs agent
- **Prompt Management**: Interacts with bolt.new's text input to update prompts

### 2. Background Service Worker (`background.js`)

The background script manages:

- **WebSocket Connection**: Maintains real-time connection to ElevenLabs API
- **Audio Streaming**: Sends PCM audio chunks to ElevenLabs for processing
- **Message Routing**: Routes tool calls from ElevenLabs to content script
- **Screenshot Capture**: Takes screenshots for AI context analysis

### 3. ElevenLabs Agent

The ElevenLabs conversational AI agent:

- Receives voice input via WebSocket
- Understands user intent through natural language
- Calls client-side tools to perform actions
- Speaks responses back to the user

## Data Flow

```
User Speaks
    ↓
Content Script (audio capture)
    ↓
Background Script (WebSocket)
    ↓
ElevenLabs Agent (AI processing)
    ↓
Tool Call Request
    ↓
Content Script (tool execution)
    ↓
Gemini API (prompt improvement)
    ↓
bolt.new Input (prompt updated)
```

## Client-Side Tools

Tools are defined in the ElevenLabs console and executed in the browser:

| Tool | Purpose | API Used |
|------|---------|----------|
| `improve_prompt` | Enhance existing prompt | Google Gemini |
| `create_prompt` | Generate new prompt | Google Gemini |
| `update_prompt` | Modify prompt with instructions | Google Gemini |
| `analyze_ui` | Analyze current screen | Google Gemini |
| `suggest_next_steps` | Recommend next actions | Google Gemini |

## Key Design Decisions

### LLM-Based Intent Recognition

Tool execution is controlled entirely by the ElevenLabs LLM. The extension does not use keyword matching or traditional programming logic to determine when to execute tools. The AI naturally understands user intent and calls the appropriate tools.

### Manual WebSocket Implementation

While ElevenLabs provides an SDK, we use manual WebSocket connections for:
- Better control over audio streaming
- Chrome extension compatibility
- Reduced bundle size
- More predictable behavior

### Hybrid Approach

- **Agent Mode**: Manual WebSocket for conversational AI
- **Transcription Mode**: ElevenLabs SDK for Scribe v2 transcription

## Technologies

- Chrome Extensions Manifest V3
- ElevenLabs Conversational AI API
- ElevenLabs Scribe v2 SDK
- Google Gemini API (gemini-3-flash-preview)
- WebSocket API
- MediaRecorder API
