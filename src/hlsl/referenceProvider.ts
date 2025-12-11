'use strict';

import { ReferenceProvider, CancellationToken, TextDocument, Position, Location, SymbolInformation, commands, workspace, Uri, Range } from 'vscode';
import { resolveAllIncludes } from '../includeResolver';

/**
 * Find all references to a symbol in the given text
 */
function findReferencesInText(name: string, text: string, uri: Uri): Location[] {
    const results: Location[] = [];
    const regex = new RegExp(`\\b${name}\\b`, 'gm');
    const lines = text.split(/\r?\n/);
    
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        // Calculate line number from character position
        let charCount = 0;
        let lineNum = 0;
        for (let i = 0; i < lines.length; i++) {
            if (charCount + lines[i].length >= match.index) {
                lineNum = i;
                break;
            }
            charCount += lines[i].length + 1; // +1 for newline
        }
        
        const lineText = lines[lineNum] || '';
        const col = match.index - charCount;
        const startPos = new Position(lineNum, col >= 0 ? col : 0);
        const endPos = new Position(lineNum, col >= 0 ? col + name.length : name.length);
        results.push(new Location(uri, new Range(startPos, endPos)));
    }
    
    return results;
}

export default class HLSLReferenceProvider implements ReferenceProvider {

    public async provideReferences(document: TextDocument, position: Position, options: { includeDeclaration: boolean }, token: CancellationToken): Promise<Location[]> {
        let enable = workspace.getConfiguration('hlsl').get<boolean>('suggest.basic', true);
        if (!enable) {
            return null;
        }

        let wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        let name = document.getText(wordRange);

        let results: Location[] = [];

        const text = document.getText();
        
        const regex = new RegExp(`\\b${name}\\b`, 'gm');
        let match: RegExpExecArray = null;
        while (match = regex.exec(text)) {
            let refPosition = document.positionAt(match.index);
            results.push(new Location(document.uri, document.getWordRangeAtPosition(refPosition)));
        }

        let symbols = await commands.executeCommand<SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', name);
        symbols.filter(s => (s.name === name && s.location.uri.toString() != document.uri.toString()) ).forEach(symbol => {
            results.push(symbol.location);
        });

        // Also search in included files
        try {
            const includes = await resolveAllIncludes(document);
            for (const include of includes) {
                const includeRefs = findReferencesInText(name, include.content, include.uri);
                results.push(...includeRefs);
            }
        } catch (e) {
            console.warn('Failed to search includes for references:', e);
        }

        return results;
    }
}
