const fs = require('fs');
const { execSync } = require('child_process');

try {
    execSync('git checkout server.js', { stdio: 'inherit' });
} catch (e) {
    console.log('Checkout handled.');
}

let code = fs.readFileSync('server.js', 'utf8');

// Purana aakhri hissa hata kar saaf suthra code lagatay hain
code = code.replace(/app\.listen[\s\S]*$/, '');
code = code.trim();

// Agents management aur login ke liye dynamic support code
code += `

// --- Dynamic Agent Management & Login Routes ---
if (!global.agentsList) {
    global.agentsList = [
        { name: 'Default Agent', email: 'agent@coreedgesolution.com', password: '123', role: 'agent' }
    ];
}

// Admin: Naya agent add karne ka route
app.post('/admin/add-agent', (req, res) => {
    const { name, email, password } = req.body;
    if (name && email && password) {
        global.agentsList.push({ name, email, password, role: 'agent' });
    }
    res.redirect('/admin/schedule');
});

// Agent Login authentication route
app.post('/login-action', (req, res) => {
    const { email, password } = req.body;
    const found = global.agentsList.find(a => a.email === email && a.password === password);
    if (found) {
        if (found.role === 'admin') {
            res.redirect('/admin/portal');
        } else {
            res.redirect('/agent/dashboard');
        }
    } else {
        res.redirect('/login?error=InvalidCredentials');
    }
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("Server is running smoothly on port " + (process.env.PORT || 3000));
});
`;

fs.writeFileSync('server.js', code);
console.log('Server.js updated successfully!');
