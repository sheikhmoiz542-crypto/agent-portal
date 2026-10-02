const fs = require('fs');

// 1. package.json mein start script ko force kar do ke wo server.js chalaye
if (fs.existsSync('package.json')) {
    let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.scripts = pkg.scripts || {};
    pkg.scripts.start = "node server.js";
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
    console.log('package.json updated!');
}

// 2. server.js se saare purane PORT aur listen hata kar clean listen lagao
let code = fs.readFileSync('server.js', 'utf8');
code = code.replace(/(const|let|var)\s+PORT\s*=[^;]+;/g, '');
code = code.replace(/\bPORT\s*=\s*[^;]+;/g, '');
code = code.replace(/app\.listen[\s\S]*$/, '');
code = code.trim();

code += '\n\nconst PORT = process.env.PORT || 3000;\n';
code += 'app.listen(PORT, "0.0.0.0", () => {\n';
code += '  console.log(`Server is running on port ${PORT}`);\n';
code += '});\n';

fs.writeFileSync('server.js', code);
console.log('server.js fixed!');
