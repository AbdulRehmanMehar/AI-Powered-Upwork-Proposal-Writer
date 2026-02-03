import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import User from '@/lib/db/user';

// Parse text from various file types
async function parseResumeText(file: File): Promise<string> {
  const fileName = file.name.toLowerCase();
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Handle plain text files
  if (fileName.endsWith('.txt')) {
    return buffer.toString('utf-8');
  }
  
  // Handle markdown files
  if (fileName.endsWith('.md')) {
    return buffer.toString('utf-8');
  }
  
  // Handle PDF files - basic text extraction
  if (fileName.endsWith('.pdf')) {
    // Simple PDF text extraction (works for text-based PDFs)
    const pdfText = extractTextFromPDF(buffer);
    if (pdfText && pdfText.trim().length > 50) {
      return pdfText;
    }
    
    // If extraction failed or returned minimal text, return raw content indicator
    return `[PDF Resume: ${file.name}]\n\nNote: PDF text extraction may be incomplete. Consider uploading a .txt version of your resume for best results.`;
  }
  
  // Handle Word documents (.docx) - basic extraction
  if (fileName.endsWith('.docx')) {
    const docxText = await extractTextFromDocx(buffer);
    if (docxText && docxText.trim().length > 50) {
      return docxText;
    }
    return `[Word Document: ${file.name}]\n\nNote: DOCX text extraction may be incomplete. Consider uploading a .txt version of your resume for best results.`;
  }
  
  // For other formats, try to read as text
  try {
    const text = buffer.toString('utf-8');
    // Check if it looks like valid text
    if (text && !text.includes('\u0000') && text.trim().length > 50) {
      return text;
    }
  } catch {
    // Ignore errors
  }
  
  return `[Uploaded file: ${file.name}]\n\nUnable to extract text from this file format. Please upload a .txt, .md, or text-based PDF file.`;
}

// Basic PDF text extraction (handles simple text-based PDFs)
function extractTextFromPDF(buffer: Buffer): string {
  try {
    const pdfString = buffer.toString('latin1');
    const textParts: string[] = [];
    
    // Look for text streams in the PDF
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    let match;
    
    while ((match = streamRegex.exec(pdfString)) !== null) {
      const streamContent = match[1];
      
      // Extract text from Tj and TJ operators
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
        const text = tjMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\');
        if (text.trim()) {
          textParts.push(text);
        }
      }
      
      // Extract text from BT...ET blocks
      const btRegex = /BT[\s\S]*?ET/g;
      let btMatch;
      while ((btMatch = btRegex.exec(streamContent)) !== null) {
        const btContent = btMatch[0];
        const textInBt = /\(([^)]+)\)/g;
        let textMatch;
        while ((textMatch = textInBt.exec(btContent)) !== null) {
          const text = textMatch[1].trim();
          if (text && !textParts.includes(text)) {
            textParts.push(text);
          }
        }
      }
    }
    
    // Also try to find plain text content
    const plainTextRegex = /\/Contents\s*\(([^)]+)\)/g;
    while ((match = plainTextRegex.exec(pdfString)) !== null) {
      textParts.push(match[1]);
    }
    
    return textParts.join(' ').replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// Basic DOCX text extraction
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  try {
    // DOCX is a ZIP file containing XML
    // We'll do a simple extraction of text from the document.xml
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
      return '';
    }
    
    // Extract text from XML tags
    const textParts: string[] = [];
    const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let match;
    
    while ((match = textRegex.exec(documentXml)) !== null) {
      if (match[1].trim()) {
        textParts.push(match[1]);
      }
    }
    
    // Handle paragraph breaks
    let result = documentXml;
    result = result.replace(/<w:p[^>]*\/>/g, '\n');
    result = result.replace(/<\/w:p>/g, '\n');
    
    return textParts.join(' ').replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error('DOCX extraction error:', error);
    return '';
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

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get('resume') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
    ];
    
    const allowedExtensions = ['.pdf', '.docx', '.txt', '.md'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a PDF, DOCX, TXT, or MD file.' },
        { status: 400 }
      );
    }

    // Extract text from the resume
    const resumeText = await parseResumeText(file);

    // Save to database
    await connectToDatabase();
    
    await User.findByIdAndUpdate(session.user.id, {
      $set: {
        'profile.resumeText': resumeText,
        'profile.resumeFileName': file.name,
        'profile.resumeUploadedAt': new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        fileName: file.name,
        textLength: resumeText.length,
        preview: resumeText.substring(0, 500) + (resumeText.length > 500 ? '...' : ''),
      },
    });
  } catch (error) {
    console.error('Resume upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload resume' },
      { status: 500 }
    );
  }
}

// DELETE endpoint to remove resume
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectToDatabase();
    
    await User.findByIdAndUpdate(session.user.id, {
      $unset: {
        'profile.resumeText': 1,
        'profile.resumeFileName': 1,
        'profile.resumeUploadedAt': 1,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Resume delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete resume' },
      { status: 500 }
    );
  }
}
