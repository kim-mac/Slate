# Slate Product Roadmap: Memory Layer, Connectors, Autofill & Smart Merge

## Product Direction

Slate should evolve from a local-first clip manager into a **user-owned
personal memory and context layer**.

The long-term idea is:

**Capture → Remember → Organize → Retrieve → Connect → Act**

Slate already covers much of Capture, Remember, Organize, and Retrieve
through desktop/browser capture, search, Quick Search, live refresh, and
persistent Merge.

The next phase should make Slate useful **outside Slate itself**:

-   AI agents can save to and retrieve from Slate.
-   Each connected agent can have its own controlled Slate environment
    and permissions.
-   Slate can reuse verified personal information to help fill forms.
-   Slate can recognize relationships between saved information and
    suggest useful groups.
-   AI can eventually organize and summarize memories without destroying
    their original provenance.

The central product thesis is:

> **Slate is portable, user-owned context that follows you across
> browsers, applications, forms, and AI agents.**

------------------------------------------------------------------------

# Recommended Priority

## Priority 1 --- Slate Connectors / Agent Memory Layer

**Build this next.**

This is the strongest architectural step because it changes Slate from
an application that humans manually put information into into a memory
layer that both humans and AI agents can use.

### Core experience

A user is talking to an AI agent such as Muse and says:

> Save this to Slate.

The agent sends the information to Slate and Slate stores it as a normal
memory/clip.

Later, potentially from another agent:

> What did I save in Slate about SQLite migrations?

The agent searches the user's Slate memory and returns relevant
information.

The same memory should not be trapped inside one AI product.

### Example

**Muse**

> Research local-first AI memory architectures.

After receiving the research:

> Save this to Slate.

Slate stores the result.

Later:

**Another AI agent**

> Search my Slate for anything about local-first memory.

Slate returns the relevant memories.

### Strategic value

AI context is fragmented across products.

A user may:

-   research something with Muse;
-   discuss it with ChatGPT;
-   code it with Cursor;
-   use Claude for another part of the project.

Each AI system normally has its own context.

Slate can become the neutral memory layer underneath them:

``` text
                 Slate Memory

        Muse ─────────┤
     ChatGPT ─────────┤
      Claude ─────────┤
      Cursor ─────────┤
 Other Agents ────────┤
```

The important principle is:

> **My information belongs to me, not to whichever AI I am currently
> using.**

------------------------------------------------------------------------

## 1.1 --- Start with a Local Slate Agent API / MCP Server

Do **not** start by building Slate Cloud.

First prove the interaction locally.

A small initial Slate MCP/API surface could expose:

``` text
save_clip
search_clips
get_clip
list_recent_clips
```

Later:

``` text
get_group
merge_clips
find_related
update_clip
get_profile
```

Destructive operations such as `delete_clip` should not be part of the
first version.

### First prototype goal

Connect Slate to one MCP-capable AI client and prove two experiences:

> Save this to Slate.

and:

> What have I saved about X?

If those interactions are genuinely useful, expand the connector
architecture.

### Why MCP

Prefer a general agent interface rather than writing a separate
integration implementation for every AI product.

Avoid:

``` text
museIntegration
chatgptIntegration
claudeIntegration
cursorIntegration
```

Prefer:

``` text
                 Slate MCP/API

Muse ───────────────┤
Claude ─────────────┤
Cursor ─────────────┤
Other Agents ───────┤
```

A Muse-specific connector can then sit on top of the general Slate
interface.

------------------------------------------------------------------------

## 1.2 --- Agent Environments

Each connected AI agent should have its **own Slate environment /
permission context**.

Connecting one agent must not automatically grant access to everything
in Slate.

Example:

``` text
Muse wants access to Slate

Allow:

✓ Save new memories
✓ Search allowed memories
✓ Read memories returned by searches

□ Access Slate Profile
□ Modify existing memories
□ Merge memories
□ Delete memories
```

Potential environment concepts:

-   Agent identity
-   Granted permissions/scopes
-   Collections or memory spaces the agent can access
-   Read/write restrictions
-   Activity history
-   Revocation
-   Optional agent-specific memory

This makes Slate useful as a shared memory layer without turning every
connected AI into an unrestricted administrator of the user's personal
information.

### Agent activity

Slate should eventually provide an activity log such as:

``` text
6:42 PM  Muse searched "SQLite migration"
6:43 PM  Muse read 3 memories
6:45 PM  Muse saved "Migration research"
```

Users should be able to understand what an agent accessed or changed.

------------------------------------------------------------------------

## 1.3 --- Muse Connector

Muse is a good first external-agent target.

Desired experience:

> User: Save this to Slate.

Muse invokes the Slate connector.

Slate receives the content and creates the memory.

Later:

> User: Search my Slate for my research about local-first AI memory.

Muse queries Slate and receives only the information permitted by the
user's connector permissions.

### Initial Muse capabilities

Recommended V1:

-   Save to Slate
-   Search Slate
-   Retrieve a selected result
-   List recent Slate memories

Later:

-   Retrieve groups
-   Merge selected memories
-   Find related memories
-   Access Slate Profile with separate permission
-   Update memories

Avoid destructive operations initially.

------------------------------------------------------------------------

## 1.4 --- Local-first vs Cloud Agents

Slate is currently local-first. This creates an architectural challenge.

A local client can communicate with:

``` text
localhost → Slate Desktop → SQLite
```

A cloud-hosted AI agent generally cannot directly access a user's
localhost.

Possible long-term approaches:

### Local only

Ideal for local/MCP-capable clients.

``` text
AI Client → Slate MCP → Slate Desktop → SQLite
```

Advantages:

-   Simple
-   Private
-   Local-first
-   No Slate account/cloud infrastructure required

Limitation:

-   Cloud-only agents cannot directly reach it.

### Slate Cloud

``` text
Slate Desktop
      ↓
    Sync
      ↓
Slate Cloud API
      ↑
Cloud Agent
```

Easier for external agents, but introduces:

-   accounts;
-   authentication;
-   synchronization;
-   hosting;
-   privacy/security responsibilities;
-   conflict resolution.

Do not start here.

### Hybrid / Relay

Potential long-term architecture:

``` text
Cloud Agent
     │
     ▼
Authenticated Slate Relay
     │
     ▼
Slate Desktop
     │
     ▼
Local SQLite
```

The local Slate database can remain canonical while the cloud service
acts primarily as an authenticated bridge.

This should only be considered after the local connector experience is
validated.

------------------------------------------------------------------------

# Priority 2 --- Slate Profile + Autofill

After the connector foundation is proven, build the first major
**action** capability.

The weak framing is:

> Slate autofills job applications.

The stronger framing is:

> **Slate remembers information you repeatedly provide online and helps
> you reuse it anywhere.**

Job applications are an excellent initial use case, but the system
should not be job-specific.

------------------------------------------------------------------------

## 2.1 --- Slate Profile

Create a structured, verified layer separate from ordinary clips.

Example:

``` text
Personal
  Name
  Email
  Phone
  Address

Education
  University
  Degree
  Graduation date

Employment
  Company
  Role
  Dates

Links
  Portfolio
  GitHub
  LinkedIn

Projects
  Slate
  Wakeey

Documents
  Resume
```

### Provenance is important

A profile field should ideally know where it came from.

Example:

``` text
Expected graduation
December 2026

Source: Resume.pdf
Verified by you
```

Slate should distinguish between:

-   verified facts;
-   extracted but unverified information;
-   AI-generated suggestions.

An AI model should never silently invent factual information for an
application.

------------------------------------------------------------------------

## 2.2 --- Slate Fill

The browser extension detects supported form fields and offers:

> **Fill with Slate**

Example:

``` text
Slate found 9 matches

✓ First name
✓ Last name
✓ Email
✓ Phone
✓ University
✓ Degree
✓ Graduation date
✓ LinkedIn
✓ GitHub

? Work authorization
? Desired salary

[Review]   [Fill 9]
```

Unknown information should remain blank.

### Important rule

**Detect → Suggest → Review → Fill**

Not:

**Detect → silently fill → submit**

Slate should never silently submit forms.

------------------------------------------------------------------------

## 2.3 --- Deterministic vs Contextual Answers

Two different systems should be used.

### Deterministic fields

Examples:

-   name;
-   email;
-   phone;
-   university;
-   degree;
-   portfolio URL.

Use stored verified values directly.

No LLM is needed.

### Contextual questions

Example:

> Tell us about a project where you solved a difficult technical
> problem.

Slate can search the user's memories and surface relevant material:

``` text
Relevant Slate memories

Persistent Merge implementation
SQLite migration debugging
ARM64 release validation
```

The user selects relevant context.

Slate drafts an answer.

The user reviews it.

Then Slate fills the field.

Pipeline:

``` text
Question
   ↓
Retrieve relevant Slate context
   ↓
User chooses/approves context
   ↓
Draft answer
   ↓
User reviews
   ↓
Fill
```

------------------------------------------------------------------------

## 2.4 --- Remember My Answer

When a user manually answers a reusable question Slate does not know,
Slate could offer:

> Remember this answer?

Example:

``` text
Relocation preference
Yes

[Remember]
```

Next time a similar question appears:

> You answered this before: Yes

**Fill**

This creates a powerful product loop:

> **The more you use Slate, the less you repeat yourself.**

------------------------------------------------------------------------

## 2.5 --- Autofill Safety

Sensitive information requires stricter handling.

Examples:

-   SSN
-   passport number
-   banking information
-   immigration identifiers
-   health information

For early versions, either:

1.  exclude highly sensitive fields entirely; or
2.  require explicit per-use confirmation.

Never expose sensitive Slate Profile information simply because an agent
or website requests it.

------------------------------------------------------------------------

# Priority 3 --- Related Clips / Smart Merge

Persistent Merge provides the structural foundation. The next
intelligence layer should help users discover **what belongs together**.

Do not begin with fully automatic AI merging.

Build this progressively.

------------------------------------------------------------------------

# Smart Merge Level 1 --- Related Clips

**No LLM required.**

Slate calculates deterministic relationships using information it
already has.

Possible signals:

-   exact `sourceUrl`;
-   page title;
-   domain;
-   source application;
-   capture time proximity;
-   existing group membership.

Example:

``` text
Today

Building Slate
ChatGPT · 6 related clips

"SQLite database..."
"Persistent Merge..."
"Native messaging..."

[Review]   [Merge]
```

The user remains in control.

### Relationship scoring

Rather than hardcoding same-source styling throughout UI components,
introduce a reusable relationship layer.

Conceptually:

``` text
Relationship types

same_page
same_domain
same_title
same_app
temporal
semantic
```

Initial deterministic scoring might conceptually look like:

``` text
same URL       +50
same title     +20
within 10 min  +15
same app        +5
```

A sufficiently strong relationship can produce a **Related** suggestion.

The exact weights should be validated rather than treated as permanent
product rules.

------------------------------------------------------------------------

# Smart Merge Level 2 --- Suggested Merge

Slate uses the relationship system to suggest groups.

Example:

``` text
Suggested group

✓ SQLite migration design
✓ Persistent Merge schema
✓ Native messaging issue
✓ ARM64 validation

These clips appear related.

[Dismiss]   [Merge 4 clips]
```

Important:

**Slate suggests. The user confirms.**

No automatic modification of the user's library.

Persistent Merge makes this safer because Merge preserves the original
member clips and their metadata.

------------------------------------------------------------------------

# Smart Merge Level 3 --- Semantic Smart Merge

Introduce semantic similarity.

Now Slate can recognize relationships even when sources differ.

Example:

``` text
Possible collection

SQLite persistence work

ChatGPT
GitHub
SQLite Documentation
Stack Overflow

4 related memories

[Review]   [Merge]
```

Possible additional signal:

``` text
semantic similarity +35
```

This should augment deterministic signals, not replace provenance.

------------------------------------------------------------------------

# Smart Merge Level 4 --- Intelligent Group Summaries

Once semantic relationships work reliably, groups can optionally contain
an AI-generated summary while preserving all original member clips.

Example:

``` text
Persistent Merge research

Summary

Slate's Merge architecture uses persistent groups rather
than concatenating clips. SQLite membership preserves
each original source and its metadata...

4 source memories

ChatGPT
Persistent Merge discussion
[Open]

GitHub
clip_groups migration
[Open]

SQLite Documentation
Foreign keys
[Open]

Stack Overflow
SQLite transaction discussion
[Open]
```

The summary is derived content.

The original clips remain the evidence/provenance.

Never replace original content with the generated summary.

------------------------------------------------------------------------

# Priority 4 --- Cross-feature Intelligence

After Connectors, Profile/Autofill, and Smart Merge exist, they should
begin working together.

This is where Slate becomes substantially more powerful.

------------------------------------------------------------------------

## Agents + Smart Merge

An agent could say:

> Save this research to Slate.

Later Slate recognizes that the saved research relates to existing
memories and suggests:

> 4 related memories found.

The user can review and merge them.

------------------------------------------------------------------------

## Agents + Slate Profile

A connected agent might need profile context.

Example:

> Draft an application answer using my relevant experience.

Slate could grant the agent temporary/read-only access to selected
profile categories.

Profile access should be a separate permission from ordinary clip
search.

------------------------------------------------------------------------

## Autofill + Slate Memory

A form asks:

> Describe a project you're proud of.

Slate retrieves relevant project memories.

The user chooses one.

Slate drafts the response.

The browser fills it after approval.

------------------------------------------------------------------------

## Autofill + Remembered Answers

A user answers:

> Are you willing to relocate?

Slate remembers the approved response.

Future websites can reuse it.

------------------------------------------------------------------------

# Long-Term Slate Architecture

The product can eventually look like:

``` text
                     USER-OWNED CONTEXT

                           Slate
                             │
             ┌───────────────┼───────────────┐
             │               │               │
          Capture          Context         Actions
             │               │               │
         Browser           Profile         Autofill
         Desktop           Memories        Agent tools
         Agents            Groups          Suggestions
             │               │               │
             └───────────────┼───────────────┘
                             │
                        Local-first
                          storage
```

Another useful framing:

``` text
INPUTS

Browser captures
Desktop captures
Muse
ChatGPT
Claude
Cursor
Other agents
Documents

        ↓

SLATE MEMORY LAYER

Clips
Groups
Relationships
Profile
Provenance
Permissions

        ↓

OUTPUTS / ACTIONS

Search
Quick Search
Smart Merge
AI retrieval
Autofill
Draft answers
Agent context
```

------------------------------------------------------------------------

# Recommended Implementation Sequence

## Phase 1 --- Connector Foundation

**Build next.**

1.  Define the Slate agent/tool API.
2.  Implement local MCP/API server.
3.  Expose only:
    -   save clip;
    -   search clips;
    -   retrieve clip;
    -   recent clips.
4.  Add permission/scoping architecture.
5.  Add agent identity.
6.  Add basic agent activity logging.
7.  Connect one local MCP-capable client.
8.  Validate:
    -   "Save this to Slate."
    -   "Search Slate for X."

**Success criterion:** Slate is genuinely useful as external AI memory
without cloud infrastructure.

------------------------------------------------------------------------

## Phase 2 --- Muse Connector Proof of Concept

1.  Investigate current Muse connector requirements.
2.  Map Muse connector operations onto the generic Slate agent API.
3.  Determine whether a local-only architecture is sufficient for
    development.
4.  Prototype Save and Search.
5.  Evaluate whether a relay is necessary for production Muse
    connectivity.
6.  Do not build full Slate Cloud unless the connector experience proves
    valuable.

**Success criterion:** A conversation with Muse can intentionally save
information into Slate and retrieve authorized Slate context.

------------------------------------------------------------------------

## Phase 3 --- Slate Profile

1.  Define structured profile schema.
2.  Separate profile facts from ordinary clips.
3.  Add provenance.
4.  Add verification state.
5.  Support manual profile editing.
6.  Explore extracting suggested facts from user-selected
    documents/memories.
7.  Never automatically treat extracted AI guesses as verified facts.

**Success criterion:** Slate has a trustworthy reusable representation
of common user information.

------------------------------------------------------------------------

## Phase 4 --- Basic Slate Autofill

Start deterministic.

1.  Browser form detection.
2.  Map common fields to verified Slate Profile fields.
3.  Review-before-fill interface.
4.  Fill common fields.
5.  Never auto-submit.
6.  Handle unknown fields safely.
7.  Add strict handling/exclusion for sensitive information.

Start with approximately 10--15 common fields rather than attempting
arbitrary web forms immediately.

**Success criterion:** Slate reliably saves time on repetitive forms
without guessing.

------------------------------------------------------------------------

## Phase 5 --- Related Clips

1.  General relationship model.
2.  Exact URL relationship.
3.  Same domain/title/app relationships.
4.  Temporal proximity.
5.  Related indicator.
6.  Review related memories.
7.  No automatic Merge.

**Success criterion:** Users discover relevant existing memories without
manually opening clips to determine relationships.

------------------------------------------------------------------------

## Phase 6 --- Suggested Merge

1.  Relationship scoring.
2.  Suggested clusters.
3.  Review UI.
4.  Dismiss suggestion.
5.  User-confirmed Merge.
6.  Learn from dismissed/accepted suggestions later if appropriate.

**Success criterion:** Slate meaningfully reduces manual organization
while preserving user control.

------------------------------------------------------------------------

## Phase 7 --- Contextual Autofill

1.  Detect long-form/application questions.
2.  Retrieve relevant Slate memories.
3.  Show the memories used.
4.  User chooses context.
5.  Generate draft.
6.  Review.
7.  Fill.
8.  Offer "Remember this answer."

**Success criterion:** Slate can help answer repetitive contextual
questions without fabricating user facts.

------------------------------------------------------------------------

## Phase 8 --- Semantic Smart Merge

1.  Semantic similarity.
2.  Cross-source relationships.
3.  Suggested semantic groups.
4.  Preserve deterministic provenance.
5.  User-confirmed grouping.
6.  Optional AI-generated group summaries.

**Success criterion:** Slate understands connections across information,
not merely matching URLs.

------------------------------------------------------------------------

## Phase 9 --- Broader Agent Ecosystem

After the generic connector model is proven:

-   Muse
-   Claude
-   Cursor
-   ChatGPT or other supported agent ecosystems
-   custom agents
-   local agents

Do not build bespoke Slate storage logic per agent.

Every integration should preferably use the same permissioned Slate
memory interface.

------------------------------------------------------------------------

# Product Principles

## 1. Local-first remains fundamental

The local database should remain the canonical source unless a
deliberate future product decision changes that.

Cloud infrastructure should solve a proven problem rather than become a
prerequisite for Slate.

## 2. Original information is sacred

AI summaries, relationships, groups, and drafts are derived layers.

Do not destroy original memories or provenance.

## 3. User confirmation before consequential actions

Especially for:

-   Merge
-   Autofill
-   profile updates
-   agent writes
-   modifications
-   destructive actions

## 4. Unknown means unknown

If Slate does not know an answer, it should say so or leave the field
blank.

Never manufacture a personal fact.

## 5. Agents receive least privilege

Connecting an agent should not mean giving it the entire Slate database.

Permissions should be explicit and revocable.

## 6. Provenance everywhere

Users should be able to understand:

-   where a fact came from;
-   which clip produced a summary;
-   which agent saved something;
-   what source a merged member belongs to;
-   what context was used to generate an answer.

## 7. Avoid automatic organization that cannot be undone

Suggestions are preferable to silent automatic changes.

Persistent Merge already gives Slate a strong reversible organization
primitive.

------------------------------------------------------------------------

# What Not to Build Yet

Avoid prematurely expanding into:

-   full cloud synchronization;
-   mobile clients;
-   collaboration/team workspaces;
-   automatic autonomous form submission;
-   unrestricted agent access;
-   fully automatic AI organization;
-   complex semantic infrastructure before deterministic relationships
    are useful;
-   separate custom backends for every AI agent.

These can become valuable later, but they dramatically increase scope
before the core Slate memory-layer thesis is proven.

------------------------------------------------------------------------

# North Star

Slate should not become just another notes app, bookmark manager,
clipboard history tool, or AI chatbot.

The long-term product is:

> **Slate is your private, portable memory and context layer. Save
> something once, find it later, connect it to related knowledge, reuse
> it when the web asks for it, and make it available to the AI agents
> you choose.**

The resulting loop is:

``` text
CAPTURE
   ↓
REMEMBER
   ↓
ORGANIZE
   ↓
CONNECT
   ↓
RETRIEVE
   ↓
ACT
   ↓
NEW CONTEXT
   ↓
SLATE REMEMBERS
```

The recommended immediate next step is therefore **Slate Connectors**,
beginning with a small local, permissioned MCP/API interface rather than
cloud infrastructure.
