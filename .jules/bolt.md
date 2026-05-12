## 2024-12-03 - Starboard Reaction Performance Bottleneck

**Learning:** The `starboardMessages` table is queried on every Discord reaction update to check if the message is already tracked. Without an index on `original_message_id`, this operation scales linearly with the number of tracked messages, potentially creating a bottleneck during high activity periods or viral moments.
**Action:** Always verify high-frequency event handlers (like `messageReactionAdd`) for database queries and ensure relevant columns are indexed.
