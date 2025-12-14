'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents an include directive found in a shader file
 */
export interface IncludeDirective {
    path: string;
    line: number;
    isSystemInclude: boolean; // <> vs ""
}

/**
 * Represents a resolved include with its content and location
 */
export interface ResolvedInclude {
    uri: vscode.Uri;
    content: string;
    line: number;
}

/**
 * Parse include directives from shader source code
 * Supports both C-style includes:
 * - #include "path/to/file.h"
 * - #include <path/to/file.h>
 */
export function parseIncludes(text: string): IncludeDirective[] {
    const includes: IncludeDirective[] = [];
    
    // Match #include "file" or #include <file> and capture the quote type
    const includeRegex = /^\s*#\s*include\s+(["<])([^">]+)[">]/gm;
    
    let match: RegExpExecArray | null;
    const lines = text.split(/\r?\n/);
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        includeRegex.lastIndex = 0;
        match = includeRegex.exec(line);
        if (match) {
            includes.push({
                path: match[2],
                line: lineNum,
                isSystemInclude: match[1] === '<'
            });
        }
    }
    
    return includes;
}

/**
 * Get configured include paths from workspace settings
 */
export function getIncludePaths(): string[] {
    const config = vscode.workspace.getConfiguration('shader');
    return config.get<string[]>('includePaths', []);
}

/**
 * Resolve an include path to an absolute file path
 * @param includePath The path from the include directive
 * @param currentFileUri The URI of the file containing the include
 * @param isSystemInclude Whether this is a system include (<>) or local include ("")
 */
export async function resolveIncludePath(
    includePath: string,
    currentFileUri: vscode.Uri,
    isSystemInclude: boolean
): Promise<vscode.Uri | null> {
    const currentDir = path.dirname(currentFileUri.fsPath);
    const searchPaths: string[] = [];
    
    // For local includes, search relative to current file first
    if (!isSystemInclude) {
        searchPaths.push(currentDir);
    }
    
    // Add configured include paths
    const configuredPaths = getIncludePaths();
    for (const configPath of configuredPaths) {
        if (path.isAbsolute(configPath)) {
            searchPaths.push(configPath);
        } else {
            // Resolve relative to workspace folders
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                for (const folder of workspaceFolders) {
                    searchPaths.push(path.join(folder.uri.fsPath, configPath));
                }
            }
        }
    }
    
    // Add workspace folders as fallback search paths
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            searchPaths.push(folder.uri.fsPath);
        }
    }
    
    // For system includes, also check current directory as fallback
    if (isSystemInclude) {
        searchPaths.push(currentDir);
    }
    
    // Search for the file
    for (const searchPath of searchPaths) {
        const fullPath = path.join(searchPath, includePath);
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
            return vscode.Uri.file(fullPath);
        } catch {
            // File doesn't exist at this path, try next
        }
    }
    
    return null;
}

/**
 * Resolve all includes in a document, including nested includes
 * @param document The document to resolve includes for
 * @param maxDepth Maximum recursion depth to prevent infinite loops
 * @param visited Set of already visited file paths to prevent circular includes
 */
export async function resolveAllIncludes(
    document: vscode.TextDocument,
    maxDepth: number = 10,
    visited: Set<string> = new Set()
): Promise<ResolvedInclude[]> {
    if (maxDepth <= 0) {
        return [];
    }
    
    const filePath = document.uri.fsPath;
    if (visited.has(filePath)) {
        return [];
    }
    visited.add(filePath);
    
    const result: ResolvedInclude[] = [];
    const text = document.getText();
    const includes = parseIncludes(text);
    
    for (const include of includes) {
        const resolvedUri = await resolveIncludePath(
            include.path,
            document.uri,
            include.isSystemInclude
        );
        
        if (resolvedUri && !visited.has(resolvedUri.fsPath)) {
            try {
                // Try to get content from open document first
                let content: string;
                const openDoc = vscode.workspace.textDocuments.find(
                    d => d.uri.fsPath === resolvedUri.fsPath
                );
                
                if (openDoc) {
                    content = openDoc.getText();
                } else {
                    // Read from file system
                    const bytes = await vscode.workspace.fs.readFile(resolvedUri);
                    content = Buffer.from(bytes).toString('utf-8');
                }
                
                result.push({
                    uri: resolvedUri,
                    content,
                    line: include.line
                });
                
                // Recursively resolve nested includes
                const nestedDoc = openDoc || await vscode.workspace.openTextDocument(resolvedUri);
                const nestedIncludes = await resolveAllIncludes(nestedDoc, maxDepth - 1, visited);
                result.push(...nestedIncludes);
            } catch (e) {
                // Failed to read include file, skip it
                console.warn(`Failed to read include file: ${resolvedUri.fsPath}`, e);
            }
        }
    }
    
    return result;
}

/**
 * Get the text content from a document or file URI
 */
export async function getDocumentText(uri: vscode.Uri): Promise<string | null> {
    // Try to get from open documents first
    const openDoc = vscode.workspace.textDocuments.find(
        d => d.uri.fsPath === uri.fsPath
    );
    
    if (openDoc) {
        return openDoc.getText();
    }
    
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf-8');
    } catch {
        return null;
    }
}

/**
 * Check if a file path matches shader file extensions
 */
export function isShaderFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const shaderExtensions = [
        // HLSL
        '.hlsl', '.hlsli', '.fx', '.fxh', '.vsh', '.psh', '.cginc', '.compute', '.ush', '.usf', '.sf',
        // GLSL
        '.glsl', '.glslv', '.glslf', '.glslg', '.vs', '.fs', '.gs', '.vsf', '.fsh', '.vsh', '.gsh',
        '.vshader', '.fshader', '.gshader', '.comp', '.vert', '.tesc', '.tese', '.frag', '.geom',
        '.mesh', '.task', '.rgen', '.rint', '.rahit', '.rchit', '.rmiss', '.rcall',
        // Cg
        '.cg',
        // Common header extensions
        '.h', '.inc'
    ];
    return shaderExtensions.includes(ext);
}
