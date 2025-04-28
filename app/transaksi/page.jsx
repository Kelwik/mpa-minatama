'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AppSidebar } from '@/components/app-sidebar';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function Transaksi() {
  const [user, setUser] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check authentication
  const fetchSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setUser(session?.user || null);
    setLoading(false);
  };

  // Fetch transactions
  const fetchTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(
          `
          transaction_type,
          quantity,
          transaction_date,
          notes,
          lobster_types (name),
          weight_classes (weight_range)
        `
        )
        .order('transaction_date', { ascending: false });
      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      setError(error.message);
      toast.error('Failed to load transactions', {
        description: error.message,
      });
    }
  };

  // Normalize notes (handle objects, strings, null)
  const getNotesDisplay = (notes) => {
    if (!notes) return 'N/A';
    if (typeof notes === 'string') return notes;
    if (typeof notes === 'object') {
      return notes.note || JSON.stringify(notes) || 'N/A';
    }
    return 'N/A';
  };

  // Export transactions to PDF
  const exportToPDF = () => {
    if (transactions.length === 0) {
      toast.warning('No Transactions', {
        description: 'No transactions available to export.',
      });
      return;
    }

    try {
      console.log('Exporting PDF with transactions:', transactions);
      const doc = new jsPDF();
      // Apply autoTable to jsPDF instance
      autoTable(doc, {
        startY: 30,
        head: [['Type', 'Lobster', 'Weight', 'Quantity', 'Notes', 'Date']],
        body: transactions.map((t) => {
          const row = [
            t.transaction_type || 'Unknown',
            t.lobster_types?.name || 'N/A',
            t.weight_classes?.weight_range || 'N/A',
            `${Math.abs(t.quantity) ?? 0} Ekor`,
            getNotesDisplay(t.notes),
            t.transaction_date
              ? format(new Date(t.transaction_date), 'dd MMMM yyyy', {
                  locale: id,
                })
              : 'N/A',
          ];
          console.log('PDF row:', row);
          return row;
        }),
      });
      doc.text('Transaction History', 14, 20);
      console.log('Saving PDF...');
      doc.save('transactions.pdf');
      toast.success('PDF Downloaded', {
        description: 'Transaction history saved as transactions.pdf',
      });
    } catch (error) {
      console.error('PDF Export Error:', error);
      toast.error('PDF Export Failed', {
        description: error.message || 'An unexpected error occurred.',
      });
    }
  };

  // Initial fetch and real-time subscription
  useEffect(() => {
    fetchSession();

    const initialize = async () => {
      await fetchTransactions();
    };

    initialize();

    const subscription = supabase
      .channel('transactions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions' },
        () => {
          fetchTransactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // Render loading state
  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-4"
              />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p>Loading transactions...</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Render unauthenticated state
  if (!user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-4"
              />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p>Please log in to view transactions.</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Render error state
  if (error) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-4"
              />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p className="text-red-500">Error: {error}</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Transaction History</h2>
            <Button onClick={exportToPDF}>Download PDF</Button>
          </div>
          <Table>
            <TableCaption>Transaksi Terakhir</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Jenis Transaksi</TableHead>
                <TableHead>Jenis Lobster</TableHead>
                <TableHead>Berat Lobster</TableHead>
                <TableHead>Jumlah Lobster</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead className="text-right">Tanggal Transaksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    No transactions found.
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((t) => (
                  <TableRow
                    key={`${t.transaction_date}-${t.transaction_type}-${
                      t.lobster_types?.name || 'unknown'
                    }-${t.weight_classes?.weight_range || 'unknown'}`}
                  >
                    <TableCell className="font-medium">
                      {t.transaction_type || 'Unknown'}
                    </TableCell>
                    <TableCell>{t.lobster_types?.name || 'N/A'}</TableCell>
                    <TableCell>
                      {t.weight_classes?.weight_range || 'N/A'}
                    </TableCell>
                    <TableCell
                      className={
                        t.quantity < 0 ? 'text-red-500' : 'text-green-500'
                      }
                    >
                      {Math.abs(t.quantity) ?? 0} Ekor
                    </TableCell>
                    <TableCell>{getNotesDisplay(t.notes)}</TableCell>
                    <TableCell className="text-right">
                      {t.transaction_date
                        ? format(new Date(t.transaction_date), 'dd MMMM yyyy', {
                            locale: id,
                          })
                        : 'N/A'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
