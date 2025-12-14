'use strict'

import { DefinitionProvider, ImplementationProvider, TypeDefinitionProvider, SymbolInformation, TextDocument, Position, Location, CancellationToken, Definition, workspace, commands, Range, Uri } from 'vscode';
import { resolveAllIncludes } from '../includeResolver';

/**
 * Search for a symbol definition in the given text
 * Note: These patterns are designed to match the original symbolProvider patterns,
 * which match definitions at the start of lines (after optional whitespace)
 */
function findDefinitionInText(name: string, text: string, uri: Uri): Location | null {
    // Escape special regex characters in the name
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Search for function definitions (allows for indentation and modifiers)
    const functionPattern = new RegExp(`^\\s*(?:\\w+\\s+)*\\b(${escapedName})\\s*\\(`, 'gm');
    let match = functionPattern.exec(text);
    if (match) {
        const lines = text.substring(0, match.index).split(/\r?\n/);
        const lineNum = lines.length - 1;
        const fullLine = text.split(/\r?\n/)[lineNum] || '';
        const col = fullLine.indexOf(name);
        return new Location(uri, new Position(lineNum, col >= 0 ? col : 0));
    }

    // Search for struct/cbuffer/tbuffer definitions
    const structPattern = new RegExp(`^\\s*(?:struct|cbuffer|tbuffer)\\s+(${escapedName})\\b`, 'gm');
    match = structPattern.exec(text);
    if (match) {
        const lines = text.substring(0, match.index).split(/\r?\n/);
        const lineNum = lines.length - 1;
        const fullLine = text.split(/\r?\n/)[lineNum] || '';
        const col = fullLine.indexOf(name);
        return new Location(uri, new Position(lineNum, col >= 0 ? col : 0));
    }

    // Search for variable definitions (samplers)
    const samplerPattern = new RegExp(`^\\s*(?:sampler|sampler1D|sampler2D|sampler3D|samplerCUBE|samplerRECT|sampler_state|SamplerState)\\s+(${escapedName})\\b`, 'gm');
    match = samplerPattern.exec(text);
    if (match) {
        const lines = text.substring(0, match.index).split(/\r?\n/);
        const lineNum = lines.length - 1;
        const fullLine = text.split(/\r?\n/)[lineNum] || '';
        const col = fullLine.indexOf(name);
        return new Location(uri, new Position(lineNum, col >= 0 ? col : 0));
    }

    // Search for texture definitions
    const texturePattern = new RegExp(`^\\s*(?:texture|texture2D|textureCUBE|Texture1D|Texture1DArray|Texture2D|Texture2DArray|Texture2DMS|Texture2DMSArray|Texture3D|TextureCube|TextureCubeArray|RWTexture1D|RWTexture1DArray|RWTexture2D|RWTexture2DArray|RWTexture3D)(?:\\s*<[^>]*>)?\\s+(${escapedName})\\b`, 'gm');
    match = texturePattern.exec(text);
    if (match) {
        const lines = text.substring(0, match.index).split(/\r?\n/);
        const lineNum = lines.length - 1;
        const fullLine = text.split(/\r?\n/)[lineNum] || '';
        const col = fullLine.indexOf(name);
        return new Location(uri, new Position(lineNum, col >= 0 ? col : 0));
    }

    // Search for buffer definitions
    const bufferPattern = new RegExp(`^\\s*(?:AppendStructuredBuffer|Buffer|ByteAddressBuffer|ConsumeStructuredBuffer|RWBuffer|RWByteAddressBuffer|RWStructuredBuffer|StructuredBuffer)(?:\\s*<[^>]*>)?\\s+(${escapedName})\\b`, 'gm');
    match = bufferPattern.exec(text);
    if (match) {
        const lines = text.substring(0, match.index).split(/\r?\n/);
        const lineNum = lines.length - 1;
        const fullLine = text.split(/\r?\n/)[lineNum] || '';
        const col = fullLine.indexOf(name);
        return new Location(uri, new Position(lineNum, col >= 0 ? col : 0));
    }

    return null;
}

export default class HLSLDefinitionProvider implements DefinitionProvider, ImplementationProvider, TypeDefinitionProvider {

    private async getDefinitionLocations(document: TextDocument, position: Position): Promise<Location[]> {
        let enable = workspace.getConfiguration('hlsl').get<boolean>('suggest.basic', true);
        if (!enable) {
            return [];
        }
        
        let wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return [];
        }
        
        let name = document.getText(wordRange);
        
        // First, search in the current document using document symbol provider
        const symbols = await commands.executeCommand<SymbolInformation[]>('vscode.executeDocumentSymbolProvider', document.uri);
        let result: Location[] = [];
        
        if (symbols) {
            for (let symbol of symbols) {
                if (symbol.name === name) {
                    result.push(symbol.location);
                }
            }
        }
        
        // If not found in symbols, search in included files directly
        if (result.length === 0) {
            try {
                const includes = await resolveAllIncludes(document);
                for (const include of includes) {
                    const location = findDefinitionInText(name, include.content, include.uri);
                    if (location) {
                        result.push(location);
                    }
                }
            } catch (e) {
                console.warn('Failed to search includes for definition:', e);
            }
        }
        
        return result;
    }

    public provideDefinition(document: TextDocument, position: Position, token: CancellationToken | boolean): Thenable<Definition> {
        return this.getDefinitionLocations(document, position);
    }

    public provideImplementation(document: TextDocument, position: Position, token: CancellationToken): Thenable<Definition> {
        return this.getDefinitionLocations(document, position);
    }

    public provideTypeDefinition(document: TextDocument, position: Position, token: CancellationToken): Thenable<Definition> {
        return this.getDefinitionLocations(document, position);
    }
}