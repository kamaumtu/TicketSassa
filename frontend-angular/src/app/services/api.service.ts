import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface EventData {
  id: string;
  title: string;
  description?: string;
  venue?: string;
  eventDate: string;
  bannerImageUrl?: string | null;
  checkout: boolean;
}

export interface TicketTier {
  eventId?: string;
  eventTitle?: string;
  tierKey: string;
  title: string;
  category: string;
  description: string;
  priceKes: number;
  priceUsd: number;
  features: string[];
  remainingAllocation: number;
  designatedGate: string;
  isPopular?: boolean;
}

export interface OrderPayload {
  customer: { name: string; email: string; phone: string };
  items: Array<{ tierKey: string; quantity: number }>;
  currency: 'KES' | 'USD';
  paymentMethod: 'MPESA';
}

export interface BookingOrder {
  orderReference: string;
  paymentStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  mode?: 'demo' | 'live';
}

export interface BookingPass {
  eventTitle?: string;
  passReference: string;
  qrCodeToken: string;
  attendeeName: string;
  tierName: string;
  designatedGate: string;
  status: 'VALID' | 'USED' | 'CANCELLED';
  mode?: 'demo' | 'live';
}

export interface BookingResult {
  data: BookingOrder;
  passes: BookingPass[];
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private readonly baseUrl = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:8000/api' : '/api';

  // Health Check
  checkHealth(): Observable<any> {
    return this.http.get(`${this.baseUrl}/health`);
  }

  // Events API
  getFeaturedEvent(): Observable<{ success: boolean; data: EventData | null }> {
    return this.http.get<{ success: boolean; data: EventData | null }>(`${this.baseUrl}/events/featured`);
  }

  // Ticket Tiers API
  getTicketTiers(): Observable<{ success: boolean; count: number; data: TicketTier[] }> {
    return this.http.get<{ success: boolean; count: number; data: TicketTier[] }>(`${this.baseUrl}/tickets`);
  }

  checkoutMode() {
    return this.http.get<{ mode: 'live' | 'demo' | 'unavailable' }>(`${this.baseUrl}/payments/mode`);
  }

  getPaymentGateways() {
    return this.http.get<{ success: boolean; gateways: Array<{ id: string; name: string; configured: boolean }> }>(`${this.baseUrl}/payments/gateways`);
  }

  checkPaymentStatus(orderReference: string) {
    return this.http.get<{ success: boolean; status: string; order: any; receipt?: string; passes?: BookingPass[]; reason?: string }>(`${this.baseUrl}/payments/status/${encodeURIComponent(orderReference)}`);
  }

  // Orders API
  createOrder(payload: OrderPayload) {
    return this.http.post<{ data: BookingOrder }>(`${this.baseUrl}/orders`, payload);
  }

  // M-Pesa payment prompt
  initiateMpesaStkPush(orderReference: string, phone: string) {
    return this.http.post<{ mode: 'demo' | 'live'; CheckoutRequestID?: string; checkoutRequestId?: string; CustomerMessage?: string; provider?: string }>(`${this.baseUrl}/payments/mpesa/stkpush`, { orderReference, phone });
  }

  confirmDemo(orderReference: string, checkoutRequestId: string) {
    return this.http.post<BookingResult>(`${this.baseUrl}/payments/demo/confirm`, { orderReference, checkoutRequestId });
  }

  lookupOrder(orderReference: string, email: string) {
    return this.http.post<BookingResult>(`${this.baseUrl}/orders/lookup`, { orderReference, email });
  }

  passQrUrl(token: string) {
    return `${this.baseUrl}/passes/qr/${encodeURIComponent(token)}`;
  }

  // Turnstile QR Gate Scanner Verification
  verifyDigitalPass(qrToken: string, gate: string = 'Gate B'): Observable<any> {
    return this.http.get(`${this.baseUrl}/passes/verify/${encodeURIComponent(qrToken)}?gate=${encodeURIComponent(gate)}`);
  }
}

