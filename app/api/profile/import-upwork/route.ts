import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getLoadBalancer } from '@/lib/ollama-client';

// Extract Upwork username from various URL formats
function extractUpworkUsername(input: string): string | null {
  // Handle full URLs
  const urlPatterns = [
    /upwork\.com\/freelancers\/~([a-zA-Z0-9]+)/,
    /upwork\.com\/fl\/([a-zA-Z0-9_-]+)/,
    /upwork\.com\/o\/profiles\/users\/~([a-zA-Z0-9]+)/,
  ];
  
  for (const pattern of urlPatterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  
  // If it's just a username (starts with ~ or not)
  if (/^~?[a-zA-Z0-9_-]+$/.test(input)) {
    return input.replace(/^~/, '');
  }
  
  return null;
}

// Fetch Upwork profile HTML - replicates browser request closely
async function fetchUpworkProfile(username: string): Promise<string | null> {
  const urls = [
    `https://www.upwork.com/freelancers/~${username}`,
    `https://www.upwork.com/fl/${username}`,
  ];
  
  // Browser-like headers that closely match a real Chrome request
  const browserHeaders = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'priority': 'u=0, i',
    'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    'sec-ch-ua-arch': '"arm"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-full-version': '"143.0.7499.192"',
    'sec-ch-ua-full-version-list': '"Google Chrome";v="143.0.7499.192", "Chromium";v="143.0.7499.192", "Not A(Brand";v="24.0.0.0"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform': '"macOS"',
    'sec-ch-ua-platform-version': '"26.2.0"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  };

  for (const url of urls) {
    try {
      // First try a simple GET request with browser headers
      const response = await fetch(url, {
        method: 'GET',
        headers: browserHeaders,
        redirect: 'follow',
      });
      
      if (response.ok) {
        const html = await response.text();
        // Check if we got actual profile content (not a Cloudflare challenge page)
        if (
          (html.includes('og:title') || html.includes('freelancer-profile') || html.includes('Profile')) &&
          !html.includes('cf-browser-verification') &&
          !html.includes('challenge-platform')
        ) {
          return html;
        }
        
        // If we got a Cloudflare challenge, try to extract any embedded JSON data
        // Upwork sometimes embeds profile data in script tags even on challenge pages
        const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
        if (jsonMatch) {
          try {
            const nextData = JSON.parse(jsonMatch[1]);
            if (nextData?.props?.pageProps?.profile) {
              // Return the JSON as a string - we'll parse it differently
              return JSON.stringify(nextData.props.pageProps);
            }
          } catch {
            // JSON parsing failed, continue
          }
        }
      }
    } catch (error) {
      console.error(`Failed to fetch ${url}:`, error);
    }
  }
  
  // Try the API endpoint directly - Upwork has public API for some profile data
  try {
    const apiUrl = `https://www.upwork.com/api/v3/freelancers/~${username}/profile`;
    const apiResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        ...browserHeaders,
        'accept': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    
    if (apiResponse.ok) {
      const data = await apiResponse.json();
      return JSON.stringify(data);
    }
  } catch (error) {
    console.error('Failed to fetch from API:', error);
  }
  
  return null; // Return null instead of throwing - we'll handle this gracefully
}

// Fetch with user-provided cookies (power user feature)
async function fetchWithCookies(username: string, cookies: string): Promise<string | null> {
  const url = `https://www.upwork.com/freelancers/~${username}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'cookie': cookies,
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        'sec-ch-ua-arch': '"arm"',
        'sec-ch-ua-bitness': '"64"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
    });
    
    if (response.ok) {
      const html = await response.text();
      // Verify we got actual content
      if (html.length > 5000 && !html.includes('challenge-platform')) {
        return html;
      }
    }
  } catch (error) {
    console.error('Failed to fetch with cookies:', error);
  }
  
  return null;
}

// Extract text content from HTML (basic extraction)
function extractTextFromHtml(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Extract JSON-LD data if present (Upwork uses this)
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  let jsonLdData = '';
  if (jsonLdMatch) {
    try {
      const parsed = JSON.parse(jsonLdMatch[1]);
      jsonLdData = `\n\nStructured Data:\n${JSON.stringify(parsed, null, 2)}`;
    } catch {
      // Ignore JSON parse errors
    }
  }
  
  // Extract meta tags
  const metaMatches = html.matchAll(/<meta[^>]*(?:name|property)="([^"]*)"[^>]*content="([^"]*)"/gi);
  let metaData = '\n\nMeta Data:\n';
  for (const match of metaMatches) {
    if (match[1] && match[2]) {
      metaData += `${match[1]}: ${match[2]}\n`;
    }
  }
  
  // Get title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? `Title: ${titleMatch[1]}\n` : '';
  
  // Remove HTML tags and get text
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ');
  text = text.trim();
  
  // Limit text length to avoid token limits
  const maxLength = 8000;
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  
  return title + text + metaData + jsonLdData;
}

// Use AI to extract structured profile data
async function extractProfileWithAI(profileText: string): Promise<Record<string, unknown>> {
  const loadBalancer = getLoadBalancer();
  
  const systemPrompt = `You are a data extraction expert. Extract structured profile information from Upwork freelancer profiles.
  
Return a JSON object with ONLY these fields (use null for missing data):
{
  "title": "Professional title/headline",
  "summary": "Professional overview/bio (max 500 chars)",
  "yearsExperience": number or null,
  "hourlyRate": "Rate as string like '$50/hr' or null",
  "skills": ["array", "of", "skills"],
  "specializations": ["array", "of", "specialization areas"],
  "certifications": ["array", "of", "certifications"],
  "achievements": ["array", "of", "notable achievements or stats like '100% job success'"],
  "availability": "availability info or null",
  "timezone": "timezone or location info"
}

IMPORTANT:
- Only return valid JSON, no markdown or explanation
- Extract real data from the profile, don't make things up
- Skills should be specific technical skills
- Achievements can include job success rate, earnings, completed jobs, etc.`;

  const result = await loadBalancer.chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract profile data from this Upwork profile:\n\n${profileText}` },
    ],
    {
      temperature: 0.1, // Low temperature for consistent extraction
      maxTokens: 1000,
    }
  );

  if (!result.success) {
    throw new Error('AI extraction failed: ' + result.error);
  }

  // Parse the AI response
  try {
    // Try to extract JSON from the response
    let jsonStr = result.content;
    
    // Remove markdown code blocks if present
    jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    jsonStr = jsonStr.trim();
    
    const extracted = JSON.parse(jsonStr);
    return extracted;
  } catch (error) {
    console.error('Failed to parse AI response:', result.content);
    throw new Error('Failed to parse extracted profile data');
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { upworkUrl, manualContent, cookies } = body;

    // If manual content is provided, use that directly
    if (manualContent && manualContent.trim().length > 50) {
      try {
        const extractedData = await extractProfileWithAI(manualContent);
        return NextResponse.json({
          success: true,
          data: {
            extracted: extractedData,
            source: 'manual',
          },
        });
      } catch (error) {
        return NextResponse.json(
          { error: 'Failed to extract profile data from provided content' },
          { status: 400 }
        );
      }
    }

    if (!upworkUrl) {
      return NextResponse.json(
        { error: 'Upwork URL or username is required' },
        { status: 400 }
      );
    }

    // Extract username from URL
    const username = extractUpworkUsername(upworkUrl);
    if (!username) {
      return NextResponse.json(
        { error: 'Invalid Upwork profile URL or username' },
        { status: 400 }
      );
    }

    // Try to fetch the profile - first with cookies if provided, then without
    let html: string | null = null;
    
    if (cookies && cookies.trim().length > 10) {
      // User provided cookies - try fetching with them
      html = await fetchWithCookies(username, cookies);
    }
    
    // If no cookies provided or cookie fetch failed, try regular fetch
    if (!html) {
      html = await fetchUpworkProfile(username);
    }
    
    // If we couldn't fetch, return a special response asking for manual input
    if (!html) {
      return NextResponse.json({
        success: false,
        needsManualInput: true,
        username,
        message: 'Upwork blocks automated access. Please copy your profile content manually.',
        instructions: [
          '1. Open your Upwork profile in a browser',
          '2. Select all text on the page (Cmd+A or Ctrl+A)',
          '3. Copy it (Cmd+C or Ctrl+C)',
          '4. Paste it in the text area below',
        ],
      });
    }
    
    // Extract text content
    const profileText = extractTextFromHtml(html);
    
    if (profileText.length < 100) {
      return NextResponse.json({
        success: false,
        needsManualInput: true,
        username,
        message: 'Could not extract profile content. Please provide it manually.',
        instructions: [
          '1. Open your Upwork profile in a browser',
          '2. Select all text on the page (Cmd+A or Ctrl+A)',
          '3. Copy it (Cmd+C or Ctrl+C)',
          '4. Paste it in the text area below',
        ],
      });
    }

    // Use AI to extract structured data
    const extractedData = await extractProfileWithAI(profileText);

    return NextResponse.json({
      success: true,
      data: {
        extracted: extractedData,
        username,
        source: 'automatic',
      },
    });
  } catch (error) {
    console.error('Import Upwork profile error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import profile' },
      { status: 500 }
    );
  }
}
