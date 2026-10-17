import fs from 'node:fs';
import path from 'node:path';
import { GENERATED_MARKER, checkManaged, isManagedPath } from './generate-managed';

// Usage: bun run scripts/verify-spec-diff.ts [--strict] [--scope managed]
//   --scope managed  only the Managed Services operations (paths with a /managed
//                    segment); also checks that the generated managed types
//                    (scripts/generate-managed.ts) match the spec.
//   --strict         exit 1 on any uncovered operation (or managed type drift).

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
  scope: string;
  /** Generated managed type files that differ from the spec (null when not checked). */
  managedTypeDrift: string[] | null;
  managedTypeError?: string;
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
        const content = fs.readFileSync(fullPath, 'utf8');
        // Generated tables name every operation by design; coverage counts
        // only the hand-written methods that call them.
        if (content.includes(GENERATED_MARKER)) continue;
        combined += content + '\n';
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

function scopeArg(): string {
  const index = process.argv.indexOf('--scope');
  if (index >= 0) return process.argv[index + 1] ?? 'all';
  const inline = process.argv.find((arg) => arg.startsWith('--scope='));
  return inline ? inline.slice('--scope='.length) : 'all';
}

function runVerification(): DiffReport {
  const specPath = resolveOpenApiSpecPath();
  const scope = scopeArg();
  if (scope !== 'all' && scope !== 'managed') throw new Error(`Unknown --scope ${scope} (use all or managed)`);
  const operations = parseOpenApiOperations(specPath).filter((op) => scope === 'all' || isManagedPath(op.path));

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

  let managedTypeDrift: string[] | null = null;
  let managedTypeError: string | undefined;
  try {
    managedTypeDrift = checkManaged(specPath);
  } catch (error) {
    managedTypeError = error instanceof Error ? error.message : String(error);
  }

  return {
    timestamp: new Date().toISOString(),
    scope,
    managedTypeDrift,
    managedTypeError,
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
  console.log(`Scope:                    ${report.scope === 'managed' ? 'Managed Services (/managed paths)' : 'all operations'}`);
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

  if (report.managedTypeError) {
    console.log(`⚠️  Managed types not checked: ${report.managedTypeError}\n`);
  } else if (report.managedTypeDrift && report.managedTypeDrift.length > 0) {
    console.log('⚠️  Generated managed types drift from the spec (run: make generate-managed):');
    for (const file of report.managedTypeDrift) console.log(`   - ${file}`);
    console.log('');
  } else {
    console.log('✅ Generated managed types (TS + Go) match the spec.');
  }

  console.log('=============================================================\n');

  const strictMode = process.argv.includes('--strict');
  const typeProblem =
    report.scope === 'managed' && (report.managedTypeError !== undefined || (report.managedTypeDrift?.length ?? 0) > 0);
  const hasDiffs = report.missingTsOperations.length > 0 || report.missingGoOperations.length > 0 || typeProblem;

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
