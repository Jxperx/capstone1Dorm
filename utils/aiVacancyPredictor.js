const fetch = require('node-fetch');

async function predictVacancyTrends(data) {
    if (!process.env.GEMINI_API_KEY) {
        return generateHeuristicPrediction(data);
    }

    const prompt = `
You are an expert real estate data analyst for "EliteStay", a premium student boarding house and condo management company.
Analyze the following data about our upcoming lease expirations, current occupancy, and recent inquiry volume.

Data:
- Current Occupancy: ${data.occupancy}
- Leases expiring in < 30 days: ${data.expiring30}
- Leases expiring in 30-60 days: ${data.expiring60}
- Leases expiring in 60-90 days: ${data.expiring90}
- Recent inquiries (last 30 days): ${data.inquiryCount}

Based on this data, provide a predictive vacancy analysis.
You MUST respond with a valid JSON object matching exactly this schema, without any markdown formatting or code blocks:
{
  "riskLevel": "Low" | "Medium" | "High",
  "predictedVacancyRate": "string (e.g. '15%')",
  "summary": "string (2-3 sentences of qualitative analysis)",
  "recommendations": ["string", "string"] (2-3 actionable steps)
}
`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    response_mime_type: "application/json"
                }
            })
        });

        if (!response.ok) {
            console.error('Gemini API Error:', await response.text());
            return generateHeuristicPrediction(data);
        }

        const result = await response.json();
        const text = result.candidates[0].content.parts[0].text;
        
        // Clean markdown if present
        const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);

    } catch (error) {
        console.error('AI Vacancy Predictor Error:', error);
        return generateHeuristicPrediction(data);
    }
}

function generateHeuristicPrediction(data) {
    // Fallback if API fails or no key
    const totalExpiring = data.expiring30 + data.expiring60 + data.expiring90;
    
    let riskLevel = "Low";
    let summary = "Occupancy remains stable with minimal upcoming turnover.";
    let recommendations = ["Continue standard marketing efforts."];

    if (totalExpiring > 5 && data.inquiryCount < 3) {
        riskLevel = "High";
        summary = "High volume of upcoming lease expirations with low inquiry demand indicates a potential drop in occupancy.";
        recommendations = [
            "Launch targeted promotional campaigns for expiring units.",
            "Offer renewal incentives to tenants expiring in the next 30 days."
        ];
    } else if (totalExpiring > 0) {
        riskLevel = "Medium";
        summary = "Moderate turnover expected. Ensure units are pre-marketed 30 days before expiration.";
        recommendations = ["Begin outreach to tenants expiring in 60 days to discuss renewal."];
    }

    return {
        riskLevel,
        predictedVacancyRate: "N/A (API Disabled)",
        summary,
        recommendations
    };
}

module.exports = { predictVacancyTrends };
