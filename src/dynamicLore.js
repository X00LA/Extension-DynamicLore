import { callPopup } from "../../../../extensions.js";
import { world_info } from "../../../../world-info.js";

// Helper function to simulate getRequestHeaders
function getRequestHeaders() {
    return {};
}

// Helper function to simulate generateRaw
async function generateRaw(prompt, headers) {
    // This is a mock implementation
    return JSON.stringify({
        entries: []
    });
}

// Analyze chat messages to extract world info candidates
async function analyzeMessages(messages) {
    // Skip if no messages to analyze
    if (!messages || messages.length === 0) {
        return { newEntries: [], updatedEntries: [] };
    }

    // Build context for the LLM
    const lastMessages = messages.slice(-10);
    const context = lastMessages.map(m =>
        `${m.is_user ? 'User' : 'Character'}: ${m.mes}`
    ).join('\n');

    // Create analysis prompt
    const prompt = `Analyze the following conversation and extract information for a story's World Info database:

${context}

Focus on:
1. Important characters (names, descriptions, relationships)
2. Locations (settings, places mentioned)
3. Objects (items of significance)
4. Concepts (rules of the world, systems, organizations)

Format your response strictly as JSON:
{
  "entries": [
    {
      "type": "character|location|object|concept",
      "name": "Name of entity",
      "description": "Detailed description",
      "suggestedKeys": ["key1", "key2"],
      "confidence": 0.0-1.0
    }
  ]
}`;

    try {
        // Call the LLM
        const response = await generateRaw(prompt, getRequestHeaders());

        // Parse the JSON response - in a real extension, add error handling
        // This would need better extraction from the raw response
        const jsonStart = response.indexOf('{');
        const jsonEnd = response.lastIndexOf('}') + 1;
        const jsonString = response.substring(jsonStart, jsonEnd);

        const analysisResult = JSON.parse(jsonString);

        // Process the results into new entries and updates
        return processAnalysisResults(analysisResult.entries);
    } catch (error) {
        console.error("Error analyzing messages:", error);
        return { newEntries: [], updatedEntries: [] };
    }
}

// Process results from the LLM analysis
function processAnalysisResults(entries) {
    const newEntries = [];
    const updatedEntries = [];

    for (const entry of entries) {
        const existingEntry = findExistingWorldInfo(entry.name, entry.suggestedKeys);

        if (existingEntry) {
            // This entry already exists in some form, propose an update
            const mergedEntry = {
                id: existingEntry.uid,
                name: entry.name,
                originalContent: existingEntry.content,
                newContent: entry.description,
                mergedContent: mergeContents(existingEntry.content, entry.description),
                suggestedKeys: entry.suggestedKeys,
                type: entry.type,
                confidence: entry.confidence
            };

            updatedEntries.push(mergedEntry);
        } else {
            // This seems to be a new entry
            newEntries.push(entry);
        }
    }

    return { newEntries, updatedEntries };
}

// Find if an entry already exists in world info
function findExistingWorldInfo(name, keys) {
    // Check by name similarity
    const nameMatch = world_info.entries.find(entry => {
        // Extract a potential name from the first line of content
        const firstLine = entry.content.split('\n')[0];
        return firstLine.toLowerCase().includes(name.toLowerCase());
    });

    if (nameMatch) return nameMatch;

    // Check by keys
    for (const key of keys) {
        const keyMatch = world_info.entries.find(entry => {
            const entryKeys = entry.key.split(',').map(k => k.trim().toLowerCase());
            return entryKeys.includes(key.toLowerCase());
        });

        if (keyMatch) return keyMatch;
    }

    return null;
}

// Merge old and new content intelligently
function mergeContents(oldContent, newContent) {
    // In a real extension, we'd call the LLM again to do a smart merge
    // For now, simple concatenation with a separator
    return `${oldContent}\n\nAdditional information:\n${newContent}`;
}

export { analyzeMessages };
