import fs from 'node:fs';
import path from 'node:path';

interface OpenApiSpec {
  paths?: Record<string, Record<string, {
    operationId?: string;
    summary?: string;
    tags?: string[];
    parameters?: Array<{ name: string; in: string; required?: boolean }>;
    requestBody?: unknown;
    responses?: Record<string, unknown>;
  }>>;
}

interface DiffReport {
  timestamp: string;
  totalOpenApiOperations: number;
  tsCoveragePercent: number;
  goCoveragePercent: number;
  missingTsOperations: Array<{ method: string; path: string; operationId: string; tag: string }>;
  missingGoOperations: Array<{ method: string; path: string; operationId: string; tag: string }>;
}

function resolveOpenApiSpecPath(): string {
  if (process.env.OPENAPI_PATH) {
    return process.env.OPENAPI_PATH;
  }
  const defaultPath = path.resolve(import.meta.dirname, '../../hubfly-dashboard/openapi.json');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  const cwdPath = path.resolve(process.cwd(), '../hubfly-dashboard/openapi.json');
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  throw new Error(`OpenAPI spec not found at ${defaultPath} or ${cwdPath}. Set OPENAPI_PATH env variable.`);
}

function parseOpenApiOperations(specPath: string) {
  const content = fs.readFileSync(specPath, 'utf8');
  const spec: OpenApiSpec = JSON.parse(content);
  const operations: Array<{
    method: string;
    path: string;
    operationId: string;
    tag: string;
    summary: string;
    params: string[];
  }> = [];

  for (const [routePath, methods] of Object.entries(spec.paths || {})) {
    for (const [method, details] of Object.entries(methods)) {
      const opId = details.operationId || '';
      const tag = (details.tags && details.tags[0]) || (routePath.split('/')[3] || 'general');
      const summary = details.summary || '';
      const params = (details.parameters || []).map((p) => p.name);
      operations.push({
        method: method.toUpperCase(),
        path: routePath,
        operationId: opId,
        tag,
        summary,
        params,
      });
    }
  }

  return operations;
}

function scanSdkCode(sdkDir: string, extension: string): string {
  let combined = '';
  function readDirRecursive(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
        readDirRecursive(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(extension) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('_test.go')) {
        combined += fs.readFileSync(fullPath, 'utf8') + '\n';
      }
    }
  }
  readDirRecursive(sdkDir);
  return combined;
}

function normalizePath(routePath: string): string {
  // Convert /api/v1/projects/:projectId/load-balancers/:lbId -> /api/v1/projects/VAR/load-balancers/VAR
  return routePath.replace(/:[a-zA-Z0-9_]+/g, 'VAR').replace(/\{[a-zA-Z0-9_]+\}/g, 'VAR');
}

function isPathInCode(openApiPath: string, code: string): boolean {
  if (code.includes(openApiPath)) return true;
  const norm = normalizePath(openApiPath);

  // Check TS template path string (e.g. /api/v1/projects/${projectId}/load-balancers/${lbId})
  const tsPathRegexStr = openApiPath
    .replace(/\//g, '\\/')
    .replace(/:[a-zA-Z0-9_]+/g, '\\$\\{[^\\}]+\\}');
  if (new RegExp(tsPathRegexStr).test(code)) return true;

  // Check Go format path string (e.g. /api/v1/projects/%s/load-balancers/%s)
  const goPathStr = openApiPath.replace(/:[a-zA-Z0-9_]+/g, '%s');
  if (code.includes(goPathStr)) return true;

  return false;
}

function runVerification(): DiffReport {
  const specPath = resolveOpenApiSpecPath();
  const operations = parseOpenApiOperations(specPath);

  const tsSdkDir = path.resolve(import.meta.dirname, '../packages/ts/src');
  const goSdkDir = path.resolve(import.meta.dirname, '../packages/go');

  const tsCode = scanSdkCode(tsSdkDir, '.ts');
  const goCode = scanSdkCode(goSdkDir, '.go');

  const missingTs: DiffReport['missingTsOperations'] = [];
  const missingGo: DiffReport['missingGoOperations'] = [];

  let tsMatchedCount = 0;
  let goMatchedCount = 0;

  for (const op of operations) {
    const pascalOpId = op.operationId ? op.operationId.charAt(0).toUpperCase() + op.operationId.slice(1) : '';

    // TS Check
    const inTs = (op.operationId && tsCode.includes(op.operationId)) || isPathInCode(op.path, tsCode);
    if (inTs) {
      tsMatchedCount++;
    } else {
      missingTs.push({
        method: op.method,
        path: op.path,
        operationId: op.operationId,
        tag: op.tag,
      });
    }

    // Go Check
    const inGo =
      (pascalOpId && goCode.includes(pascalOpId)) ||
      (op.operationId && goCode.includes(op.operationId)) ||
      isPathInCode(op.path, goCode);
    if (inGo) {
      goMatchedCount++;
    } else {
      missingGo.push({
        method: op.method,
        path: op.path,
        operationId: op.operationId,
        tag: op.tag,
      });
    }
  }

  const tsCoverage = Math.round((tsMatchedCount / operations.length) * 100);
  const goCoverage = Math.round((goMatchedCount / operations.length) * 100);

  return {
    timestamp: new Date().toISOString(),
    totalOpenApiOperations: operations.length,
    tsCoveragePercent: tsCoverage,
    goCoveragePercent: goCoverage,
    missingTsOperations: missingTs,
    missingGoOperations: missingGo,
  };
}

function printReport(report: DiffReport) {
  console.log('\n=============================================================');
  console.log('         HUBFLY SDK & OPENAPI SPEC VERIFICATION PIPELINE       ');
  console.log('=============================================================\n');
  console.log(`Timestamp:               ${report.timestamp}`);
  console.log(`Total OpenAPI Operations: ${report.totalOpenApiOperations}`);
  console.log(`TypeScript SDK Coverage:  ${report.tsCoveragePercent}%`);
  console.log(`Go SDK Coverage:          ${report.goCoveragePercent}%\n`);

  if (report.missingTsOperations.length > 0) {
    console.log(`⚠️  Uncovered in TypeScript SDK (${report.missingTsOperations.length}):`);
    for (const op of report.missingTsOperations.slice(0, 15)) {
      console.log(`   - [${op.method}] ${op.path} (${op.operationId})`);
    }
    if (report.missingTsOperations.length > 15) {
      console.log(`   ... and ${report.missingTsOperations.length - 15} more`);
    }
    console.log('');
  } else {
    console.log('✅ TypeScript SDK is 100% synchronized with OpenAPI spec!');
  }

  if (report.missingGoOperations.length > 0) {
    console.log(`⚠️  Uncovered in Go SDK (${report.missingGoOperations.length}):`);
    for (const op of report.missingGoOperations.slice(0, 15)) {
      console.log(`   - [${op.method}] ${op.path} (${op.operationId})`);
    }
    if (report.missingGoOperations.length > 15) {
      console.log(`   ... and ${report.missingGoOperations.length - 15} more`);
    }
    console.log('');
  } else {
    console.log('✅ Go SDK is 100% synchronized with OpenAPI spec!');
  }

  console.log('=============================================================\n');

  const strictMode = process.argv.includes('--strict');
  const hasDiffs = report.missingTsOperations.length > 0 || report.missingGoOperations.length > 0;

  if (strictMode && hasDiffs) {
    console.error('ERROR: SDK spec drift detected in strict mode!');
    process.exit(1);
  } else {
    console.log('Pipeline verification check completed successfully.');
    process.exit(0);
  }
}

const report = runVerification();
printReport(report);
