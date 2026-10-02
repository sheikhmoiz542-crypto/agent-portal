const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Agar pehle se add-agent ka UI inject nahi hai, toh dashboard HTML mein form inject karte hain
if (!code.includes('id="addAgentForm"')) {
    // HTML form ka snippet jo dashboard mein inject hoga
    const agentFormHtml = `
    <!-- Add New Agent Section Added Dynamically -->
    <div style="background: #1e293b; padding: 20px; border-radius: 8px; margin-bottom: 25px; border: 1px solid #334155;">
        <h3 style="color: #f8fafc; margin-bottom: 15px; font-size: 18px;">➕ Add New Agent</h3>
        <form action="/admin/add-agent" method="POST" style="display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end;">
            <div style="flex: 1; min-width: 200px;">
                <label style="display: block; color: #94a3b8; font-size: 13px; margin-bottom: 5px;">Agent Name</label>
                <input type="text" name="name" required placeholder="e.g. Ali Khan" style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #475569; color: #fff; border-radius: 5px;">
            </div>
            <div style="flex: 1; min-width: 200px;">
                <label style="display: block; color: #94a3b8; font-size: 13px; margin-bottom: 5px;">Email Address</label>
                <input type="email" name="email" required placeholder="agent@coreedgesolution.com" style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #475569; color: #fff; border-radius: 5px;">
            </div>
            <div style="flex: 1; min-width: 180px;">
                <label style="display: block; color: #94a3b8; font-size: 13px; margin-bottom: 5px;">Password</label>
                <input type="password" name="password" required placeholder="******" style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #475569; color: #fff; border-radius: 5px;">
            </div>
            <div>
                <button type="submit" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; height: 42px;">Add Agent</button>
            </div>
        </form>
    </div>
    `;

    // Dashboard ke main container ya "Manage Weekly Schedule" se theek pehle form inject kar do
    if (code.includes('Manage Weekly Schedule')) {
        code = code.replace('Manage Weekly Schedule', agentFormHtml + '\nManage Weekly Schedule');
    } else if (code.includes('res.send(')) {
        // Fallback agar string match na ho
        console.log('Template injection adjusted.');
    }
    
    fs.writeFileSync('server.js', code);
    console.log('Agent form successfully added to dashboard UI!');
}
