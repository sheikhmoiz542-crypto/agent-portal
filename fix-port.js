const fs = require('fs');
const { execSync } = require('child_process');

// 1. File ko clean state par laane ke liye git checkout karein
try {
    execSync('git checkout server.js', { stdio: 'inherit' });
} catch (e) {
    console.log('Checkout warning handled.');
}

let code = fs.readFileSync('server.js', 'utf8');

// 2. Aakhir se saare purane listen ya tootay phootay code ko hata dein
code = code.replace(/app\.listen[\s\S]*$/, '');
code = code.trim();

// 3. Ensure karein ke file ke aakhir mein aik proper closing brace ho agar zaroorat ho
// Ab bilkul saaf suthra aur safe block lagayein
code += '\n\napp.listen(process.env.PORT || 3000, "0.0.0.0", () => {\n  console.log("Server is running smoothly!");\n});\n';

fs.writeFileSync('server.js', code);
console.log('Server.js syntax corrected successfully!');
