# Product Specification

## Working concept

A personal memory layer for AI conversations.

Users frequently receive useful information from ChatGPT, Claude, Gemini, Perplexity and other AI tools, but later have to scroll through old chats or manually copy content into random notes.

This product lets users save useful snippets directly from AI conversations and quickly retrieve them later.

## Product principles

### 1. Capture should be frictionless
A user should be able to highlight text and save it in one action.

### 2. Retrieval should be faster than reopening an old AI chat
The desktop app should be keyboard-first and searchable.

### 3. Local-first
The default experience must require:
- no account
- no login
- no backend
- no cloud storage

### 4. Atomic content
The basic unit is a `Clip`, not a document or note.

A clip may be:
- text
- code
- a prompt
- a useful AI answer
- a URL
- a future question

## MVP user flow

### Save
1. User is on ChatGPT or another website.
2. User highlights useful text.
3. Extension shows a small `Save` action or exposes a context-menu option.
4. User clicks save.
5. Extension sends the selected content and metadata to the local desktop application.
6. Desktop application stores it in SQLite.
7. User sees a subtle success confirmation.

### Find
1. User opens the Windows app or global quick-search window.
2. User starts typing.
3. Matching clips appear instantly.
4. User can copy the clip back to the clipboard.

### Reuse
For MVP:
- Copy clip
- View clip
- Edit clip
- Delete clip
- Pin clip
- Open source URL

Later:
- paste directly into active application
- context packs
- semantic search
- smart tagging
- optional encrypted sync

## MVP clip metadata

Each clip should support:

- id
- content
- content_type
- title
- source_app
- source_url
- source_page_title
- created_at
- updated_at
- is_pinned

Optional for MVP:
- tags
- collection

## Suggested content types

- text
- code
- prompt
- link

Do not over-engineer content types.

## Desktop MVP screens

### Main library
Contains:
- search field
- All Clips
- Pinned
- clip list
- selected clip preview

### Clip actions
- Copy
- Edit
- Delete
- Pin / Unpin
- Open source

### Settings
For MVP, only basic local settings.

Show privacy messaging such as:

> Your clips are stored locally on this computer. No account or cloud connection is required.

## Extension MVP

Support Chromium browsers:
- Google Chrome
- Microsoft Edge

Initial capture methods:
- context-menu item: `Save to <app>`
- optional floating save button after text selection

Start with the context menu if it reduces complexity.

Metadata captured:
- selected text
- page URL
- page title
- detected source such as ChatGPT / Claude / Gemini / Web

## Out of scope for MVP

Do not build:
- account system
- Supabase
- cloud sync
- billing
- teams
- collaboration
- mobile app
- AI auto-tagging
- embeddings
- semantic search
- browser history ingestion
- automatic full-chat scraping
- clipboard history
- task management system
- direct integrations with OpenAI/Anthropic APIs

These may be revisited after the local MVP works reliably.

## UX tone

The app should feel:
- fast
- minimal
- keyboard-friendly
- calm
- native enough for Windows
- closer to Raycast/Spotlight than Notion

Avoid turning it into a dashboard-heavy productivity app.
