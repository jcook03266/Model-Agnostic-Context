/**
 * Removes any markdown and or escaped characters from the string and returns
 * only a valid JSON string to be parsed by a JSON parser.
 * 
 * @param jsonString 
 * @returns A valid JSON string
 */
export function extractValidJSON(jsonString: string): string {
    return jsonString
        .trim()
        .replace(/^```(?:json)?/, '')  // Remove opening ```json or ```
        .replace(/```$/, '')           // Remove closing ```
        .trim();
}