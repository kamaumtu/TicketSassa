const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { publicOrigin, emailConfig } = require('../accountProviders');
const { GeneratedTicket } = require('../../models/automation');

const publicRoot = path.resolve(__dirname, '../../..');

function generateTicketIdentifiers() {
    const year = new Date().getFullYear();
    const num = randomBytes(4).toString('hex').toUpperCase();
    const qrToken = 'TKT-' + randomBytes(12).toString('hex').toUpperCase();
    const bookingRef = 'BK-' + year + '-' + randomBytes(3).toString('hex').toUpperCase();
    return { ticketNumber: `TS-${year}-${num}`, qrToken, bookingRef };
}

async function createGeneratedTicket({ event, customerName, customerEmail = '', customerPhone = '', category, priceKes, priceType = 'verified', createdBy = 'admin' }) {
    if (!event?.authorizedToSell && !event?.isOrganizerOwned) {
        throw Object.assign(
            new Error('Ticket generation is restricted to events where the platform has authorization to sell tickets.'),
            { status: 403 }
        );
    }
    const { ticketNumber, qrToken, bookingRef } = generateTicketIdentifiers();
    const origin = publicOrigin() || ('http://localhost:' + (process.env.PORT || 8000));
    const verificationUrl = `${origin}/api/automation/tickets/verify/${encodeURIComponent(qrToken)}`;

    const doc = await GeneratedTicket.create({
        ticketNumber,
        qrToken,
        bookingRef,
        eventId: String(event.externalId || event.id || event._id),
        eventName: event.name || event.title,
        eventPosterUrl: event.image?.url || event.image || '',
        venue: [event.venue, event.town, event.county].filter(Boolean).join(', ') || 'Kenya',
        eventDate: new Date(event.startsAt),
        customerName: String(customerName).trim().slice(0, 120),
        customerEmail: String(customerEmail || '').trim().toLowerCase(),
        customerPhone: String(customerPhone || '').trim(),
        category: String(category || 'Regular').trim().slice(0, 60),
        priceKes: Math.max(0, Math.round(Number(priceKes) || 0)),
        priceType: priceType === 'estimated' ? 'estimated' : 'verified',
        verificationUrl,
        status: 'VALID',
        createdBy
    });
    return doc.toObject();
}

async function renderTicketPdfBuffer(ticket) {
    const qrBuffer = await QRCode.toBuffer(ticket.verificationUrl || ticket.qrToken, {
        type: 'png',
        width: 180,
        margin: 1,
        errorCorrectionLevel: 'M'
    });

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 28 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageW = doc.page.width;
        const pageH = doc.page.height;

        // Top Brand Bar
        doc.rect(0, 0, pageW, 56).fill('#D81A21');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('TICKETSASA KENYA', 28, 16);
        doc.font('Helvetica').fontSize(9).text('OFFICIAL DIGITAL ADMISSION TICKET', 28, 39);
        doc.font('Helvetica-Bold').fontSize(11).text(ticket.ticketNumber, pageW - 210, 22, { width: 182, align: 'right' });

        // Event Poster (if local asset exists)
        let contentX = 28;
        if (typeof ticket.eventPosterUrl === 'string' && ticket.eventPosterUrl.startsWith('/assets/')) {
            const localPath = path.join(publicRoot, ticket.eventPosterUrl.slice(1));
            if (fs.existsSync(localPath) && /\.(png|jpe?g)$/i.test(localPath)) {
                try {
                    doc.image(localPath, 28, 72, { fit: [108, 108] });
                    contentX = 148;
                } catch {}
            }
        }

        // Event Details
        const detailsW = pageW - contentX - 185;
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(16)
            .text(ticket.eventName, contentX, 72, { width: detailsW, lineGap: 2 });

        const formattedDate = new Intl.DateTimeFormat('en-KE', {
            dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Nairobi'
        }).format(new Date(ticket.eventDate));

        doc.moveDown(0.4);
        doc.fillColor('#475569').font('Helvetica').fontSize(10)
            .text(`Date & Time: ${formattedDate}`, { width: detailsW })
            .text(`Venue: ${ticket.venue}`, { width: detailsW });

        doc.moveDown(0.6);
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11)
            .text(`Attendee: ${ticket.customerName}`, { width: detailsW })
            .text(`Category: ${ticket.category}`, { width: detailsW })
            .text(`Price: KES ${Number(ticket.priceKes).toLocaleString('en-KE')} (${ticket.priceType === 'verified' ? 'Verified Price' : 'Estimated Price'})`, { width: detailsW });

        doc.moveDown(0.4);
        doc.fillColor('#64748B').font('Helvetica').fontSize(9)
            .text(`Booking Ref: ${ticket.bookingRef}`, { width: detailsW })
            .text(`Status: ${ticket.status}`, { width: detailsW });

        // Right QR Panel
        const qrX = pageW - 168;
        doc.roundedRect(qrX - 10, 72, 152, 198, 8).lineWidth(1).strokeColor('#CBD5E1').stroke();
        doc.image(qrBuffer, qrX + 6, 84, { width: 120, height: 120 });
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8)
            .text('SCAN AT ENTRY GATE', qrX - 4, 212, { width: 140, align: 'center' });
        doc.fillColor('#475569').font('Helvetica').fontSize(7.5)
            .text(ticket.qrToken, qrX - 4, 226, { width: 140, align: 'center' });
        doc.fillColor('#64748B').fontSize(6.5)
            .text('Single-entry QR. Duplicate scans are automatically rejected.', qrX - 4, 242, { width: 140, align: 'center' });

        // Footer Verification URL
        doc.moveTo(28, pageH - 46).lineTo(pageW - 28, pageH - 46).strokeColor('#E2E8F0').stroke();
        doc.fillColor('#64748B').font('Helvetica').fontSize(8)
            .text(`Verify online: ${ticket.verificationUrl}`, 28, pageH - 36, { width: pageW - 56 });

        doc.end();
    });
}

async function emailGeneratedTicket(ticket) {
    const config = emailConfig();
    if (!config) {
        throw Object.assign(new Error('Email delivery requires RESEND_API_KEY and AUTH_EMAIL_FROM configuration.'), { status: 503 });
    }
    if (!ticket.customerEmail) {
        throw Object.assign(new Error('Customer email address is required to send this ticket.'), { status: 400 });
    }
    const pdfBuffer = await renderTicketPdfBuffer(ticket);
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: config.from,
            to: [ticket.customerEmail],
            subject: `Your Ticket for ${ticket.eventName} (${ticket.ticketNumber})`,
            text: [
                `Hello ${ticket.customerName},`,
                '',
                `Your ticket for ${ticket.eventName} is attached as a PDF.`,
                `Ticket Number: ${ticket.ticketNumber}`,
                `Category: ${ticket.category}`,
                `Price: KES ${Number(ticket.priceKes).toLocaleString('en-KE')}`,
                `Venue: ${ticket.venue}`,
                `Booking Reference: ${ticket.bookingRef}`,
                `Verification URL: ${ticket.verificationUrl}`
            ].join('\n'),
            attachments: [{ filename: `${ticket.ticketNumber}.pdf`, content: pdfBuffer.toString('base64') }]
        })
    });
    if (!response.ok) throw Object.assign(new Error('Resend rejected the ticket email.'), { status: 502 });
    return { sent: true, to: ticket.customerEmail };
}

async function renderPassPdfBuffer(pass) {
    const qrPayload = pass.qrCodeToken || pass.passReference;
    const qrBuffer = await QRCode.toBuffer(qrPayload, {
        type: 'png',
        width: 180,
        margin: 1,
        errorCorrectionLevel: 'M'
    });

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 28 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const isHoliday = Boolean(pass.itinerary);

        doc.rect(0, 0, pageW, 56).fill(isHoliday ? '#15803D' : '#D81A21');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20)
            .text(isHoliday ? 'TICKETSASA HOLIDAYS' : 'TICKETSASA KENYA', 28, 16);
        doc.font('Helvetica').fontSize(9)
            .text(isHoliday ? 'CONFIRMED HOLIDAY ITINERARY VOUCHER & CHECK-IN PASS' : 'OFFICIAL DIGITAL ADMISSION PASS', 28, 39);
        doc.font('Helvetica-Bold').fontSize(11)
            .text(pass.passReference || '', pageW - 220, 22, { width: 192, align: 'right' });

        let contentX = 28;
        const rawImg = String(pass.itinerary?.image || '').replace(/^\/+/, '');
        if (rawImg.startsWith('assets/')) {
            const localPath = path.join(publicRoot, rawImg);
            if (fs.existsSync(localPath) && /\.(png|jpe?g)$/i.test(localPath)) {
                try {
                    doc.image(localPath, 28, 72, { fit: [108, 108] });
                    contentX = 148;
                } catch {}
            }
        }

        const detailsW = pageW - contentX - 185;
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(14)
            .text(pass.eventTitle || 'Ticketsasa Booking Pass', contentX, 72, { width: detailsW, lineGap: 2 });

        doc.moveDown(0.35);
        doc.fillColor('#334155').font('Helvetica').fontSize(9.5);
        if (pass.itinerary) {
            doc.text(`Resort: ${pass.itinerary.resortName || pass.eventTitle}`, { width: detailsW });
            doc.text(`Destination: ${pass.itinerary.destination || 'Kenya'}`, { width: detailsW });
            doc.text(`Stay Dates: ${pass.itinerary.checkin} to ${pass.itinerary.checkout} (${pass.itinerary.nights} Night${pass.itinerary.nights > 1 ? 's' : ''})`, { width: detailsW });
            doc.text(`Room Category: ${pass.itinerary.roomType}`, { width: detailsW });
            if (pass.itinerary.mealPlan) {
                doc.text(`Meal Plan: ${pass.itinerary.mealPlan}`, { width: detailsW });
            }
            if (Array.isArray(pass.itinerary.addons) && pass.itinerary.addons.length) {
                doc.text(`Add-ons: ${pass.itinerary.addons.join(', ')}`, { width: detailsW });
            }
        } else {
            doc.text(`Ticket Tier: ${pass.tierName}`, { width: detailsW });
        }

        doc.moveDown(0.5);
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10.5)
            .text(`Lead Guest / Holder: ${pass.attendeeName}`, { width: detailsW })
            .text(`Check-in Point: ${pass.designatedGate || 'Travel Desk'}`, { width: detailsW });

        doc.moveDown(0.35);
        doc.fillColor('#64748B').font('Helvetica').fontSize(8.5)
            .text(`Order Ref: ${pass.orderReference}`, { width: detailsW })
            .text(`Status: ${pass.status}`, { width: detailsW });

        const qrX = pageW - 168;
        doc.roundedRect(qrX - 10, 72, 152, 198, 8).lineWidth(1).strokeColor('#CBD5E1').stroke();
        doc.image(qrBuffer, qrX + 6, 84, { width: 120, height: 120 });
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8)
            .text(isHoliday ? 'SCAN AT RESORT / DESK' : 'SCAN AT ENTRY GATE', qrX - 4, 212, { width: 140, align: 'center' });
        doc.fillColor('#475569').font('Helvetica').fontSize(7.5)
            .text(pass.qrCodeToken, qrX - 4, 226, { width: 140, align: 'center' });
        doc.fillColor('#64748B').fontSize(6.5)
            .text('Verified Ticketsasa digital voucher.', qrX - 4, 242, { width: 140, align: 'center' });

        doc.moveTo(28, pageH - 42).lineTo(pageW - 28, pageH - 42).strokeColor('#E2E8F0').stroke();
        doc.fillColor('#64748B').font('Helvetica').fontSize(8)
            .text(`Verify pass: /api/passes/verify/${encodeURIComponent(qrPayload)} | Order ${pass.orderReference}`, 28, pageH - 32, { width: pageW - 56 });

        doc.end();
    });
}

module.exports = {
    createGeneratedTicket,
    renderTicketPdfBuffer,
    renderPassPdfBuffer,
    emailGeneratedTicket
};
