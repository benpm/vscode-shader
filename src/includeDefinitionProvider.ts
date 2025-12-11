'use strict';

import { DefinitionProvider, TextDocument, Position, Location, CancellationToken, Definition, Range, Uri } from 'vscode';
import { parseIncludes, resolveIncludePath } from './includeResolver';

/**
 * Provides go-to-definition for #include directives
 * Allows users to ctrl+click on include paths to open the included file
 */
export default class IncludeDefinitionProvider implements DefinitionProvider {

    public async provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Definition | null> {
        const line = document.lineAt(position.line).text;
        
        // Check if we're on an include line
        const includeMatch = /^\s*#\s*include\s+["<]([^">]+)[">]/.exec(line);
        if (!includeMatch) {
            return null;
        }
        
        const includePath = includeMatch[1];
        const includeStart = line.indexOf(includePath);
        const includeEnd = includeStart + includePath.length;
        
        // Check if cursor is within the include path
        if (position.character < includeStart || position.character > includeEnd) {
            return null;
        }
        
        // Determine if it's a system include
        const isSystemInclude = /^\s*#\s*include\s+</.test(line);
        
        // Resolve the include path
        const resolvedUri = await resolveIncludePath(includePath, document.uri, isSystemInclude);
        
        if (resolvedUri) {
            return new Location(resolvedUri, new Position(0, 0));
        }
        
        return null;
    }
}
