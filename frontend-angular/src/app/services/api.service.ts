import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface EventData {
  title: string;
  slug: string;
  subtitle: string;
  description: string;
  venue: { name: string; complex: string; location: string };
  eventDate: string;
  gatesOpenTime: string;
  headliner: { name: string; genre: string; bio: string };
  motorsportSeries: { name: string; organizer: string; seasonRound: string };
  bannerImageUrl: string;
}

export interface StadiumZone {
  zoneKey: string;
  name: string;
  description: string;
  capacity: number;
  availablePercent: number;
  gate: string;
  includedPerks: string[];
  recommendedTier: string;
  previewImageUrl: string;
  fieldOfViewAngle: string;
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
  mode?: 'demo';
}

export interface BookingPass {
  eventTitle?: string;
  passReference: string;
  qrCodeToken: string;
  attendeeName: string;
  tierName: string;
  designatedGate: string;
  status: 'VALID' | 'USED' | 'CANCELLED';
  mode?: 'demo';
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
  getFeaturedEvent(): Observable<{ success: boolean; data: EventData }> {
    return this.http.get<{ success: boolean; data: EventData }>(`${this.baseUrl}/events/featured`);
  }

  // Talanta Stadium Zones API
  getStadiumZones(): Observable<{ success: boolean; count: number; data: StadiumZone[] }> {
    return this.http.get<{ success: boolean; count: number; data: StadiumZone[] }>(`${this.baseUrl}/zones`);
  }

  // Ticket Tiers API
  getTicketTiers(): Observable<{ success: boolean; count: number; data: TicketTier[] }> {
    return this.http.get<{ success: boolean; count: number; data: TicketTier[] }>(`${this.baseUrl}/tickets`);
  }

  // Orders API
  createOrder(payload: OrderPayload) {
    return this.http.post<{ data: BookingOrder }>(`${this.baseUrl}/orders`, payload);
  }

  // Safaricom Daraja M-Pesa STK Push
  initiateMpesaStkPush(orderReference: string, phone: string) {
    return this.http.post<{ CheckoutRequestID: string }>(`${this.baseUrl}/payments/mpesa/stkpush`, { orderReference, phone });
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

