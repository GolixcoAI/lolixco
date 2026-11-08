import {readFileSync, readdirSync} from 'node:fs';
import {resolve, relative} from 'node:path';
import {pathToFileURL} from 'node:url';

const checks = [
 ['loopback_url', /(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/"'\s]|$)/i],
 ['private_workstation_path', /\/home\/rohan\/|\/mnt\/[a-z]\/Users\/|[A-Z]:\\Users\\/],
 ['google_api_key', /AIza[A-Za-z0-9_-]{30,}/],
 ['google_authorization_key', /\bAQ\.[A-Za-z0-9._~+/=-]{40,}/],
 ['aws_access_key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
 ['provider_secret_assignment', /(?:GEMINI_API_KEY|GOOGLE_API_KEY|YOUTUBE_API_KEY)\s*[=:]\s*["'][A-Za-z0-9_-]{20,}["']/],
];

export function inspectReleaseBuild(directory) {
 const root = resolve(directory);
 const violations = [];
 let inspectedFiles = 0;
 function inspect(folder) {
  for (const entry of readdirSync(folder, {withFileTypes:true})) {
   const file = resolve(folder, entry.name);
   if (entry.isSymbolicLink()) {
    violations.push({file:relative(root,file),code:'unexpected_symlink'});
   } else if (entry.isDirectory()) inspect(file);
   else if (/\.(?:html|js|css|json|map|txt|svg)$/i.test(entry.name)) {
    inspectedFiles++;
    const data = readFileSync(file, 'utf8');
    for (const [code, pattern] of checks) {
     if (pattern.test(data)) violations.push({file:relative(root,file),code});
    }
   }
  }
 }
 inspect(root);
 const html = readFileSync(resolve(root,'index.html'),'utf8');
 if (!/<title>[^<]+<\/title>/i.test(html)) violations.push({file:'index.html',code:'missing_page_title'});
 if (!/<meta\s+name=["']description["'][^>]+>/i.test(html)) violations.push({file:'index.html',code:'missing_description'});
 return {inspectedFiles,violations};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try {
  const result = inspectReleaseBuild(process.argv[2] || 'dist');
  console.log(JSON.stringify(result, null, 2));
  if (result.violations.length) process.exitCode=1;
 } catch {
  console.error('Build inspection could not complete. Build the frontend first, then inspect the generated directory.');
  process.exitCode=1;
 }
}
