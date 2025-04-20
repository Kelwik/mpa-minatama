'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Box, FolderInput, FolderOutput } from 'lucide-react';
import { ChartBulan } from '@/components/chart-jenis';
import { AppSidebar } from '@/components/app-sidebar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [totalStock, setTotalStock] = useState(0);
  const [incomingThisMonth, setIncomingThisMonth] = useState(0);
  const [outgoingThisMonth, setOutgoingThisMonth] = useState(0);
  const [stockByType, setStockByType] = useState([]);
  const [weightClasses, setWeightClasses] = useState({});
  const [selectedType, setSelectedType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check authentication
  useEffect(() => {
    const fetchSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setLoading(false);
    };
    fetchSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );

    return () => {
      authListener.subscription?.unsubscribe();
    };
  }, []);

  // Fetch weight classes for a type
  const fetchWeightClasses = async (typeName) => {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), 5000);
      });

      const result = await Promise.race([
        (async () => {
          const { data: typeData, error: typeError } = await supabase
            .from('lobster_types')
            .select('id')
            .eq('name', typeName)
            .single();
          if (typeError) throw typeError;
          if (!typeData) return [];

          const { data: inventoryData, error: inventoryError } = await supabase
            .from('inventory')
            .select(
              `
              weight_class_id,
              quantity,
              weight_classes (weight_range)
            `
            )
            .eq('type_id', typeData.id);
          if (inventoryError) throw inventoryError;

          let weightClassData = inventoryData || [];
          if (weightClassData.length === 0) {
            const { data: allWeightClasses, error: wcError } = await supabase
              .from('weight_classes')
              .select('id, weight_range');
            if (wcError) throw wcError;
            weightClassData = allWeightClasses.map((wc) => ({
              weight_class_id: wc.id,
              quantity: 0,
              weight_classes: { weight_range: wc.weight_range },
            }));
          }

          return weightClassData.map((row) => ({
            weight_range: row.weight_classes?.weight_range || 'Unknown',
            quantity: row.quantity || 0,
          }));
        })(),
        timeoutPromise,
      ]);

      setWeightClasses((prev) => ({
        ...prev,
        [typeName]: result,
      }));
    } catch (error) {
      setWeightClasses((prev) => ({
        ...prev,
        [typeName]: [],
      }));
    }
  };

  // Fetch dashboard data and preload weight classes
  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('inventory')
        .select('quantity');
      if (inventoryError) throw inventoryError;
      const total = inventoryData.reduce(
        (sum, row) => sum + (row.quantity || 0),
        0
      );
      setTotalStock(total);

      const { data: stockByTypeData, error: typeError } = await supabase.from(
        'inventory'
      ).select(`
          type_id,
          quantity,
          lobster_types (name)
        `);
      if (typeError) throw typeError;

      const grouped = stockByTypeData.reduce((acc, row) => {
        const typeName = row.lobster_types?.name;
        if (typeName) {
          acc[typeName] = (acc[typeName] || 0) + (row.quantity || 0);
        }
        return acc;
      }, {});
      const stockByTypeArray = Object.entries(grouped).map(
        ([name, total_quantity]) => ({
          lobster_type: name,
          total_quantity,
        })
      );
      setStockByType(stockByTypeArray);

      // Preload weight classes
      for (const type of stockByTypeArray) {
        await fetchWeightClasses(type.lobster_type);
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const { data: transactionsData, error: transactionsError } =
        await supabase
          .from('transactions')
          .select('quantity, transaction_type, transaction_date')
          .gte('transaction_date', startOfMonth.toISOString())
          .lte('transaction_date', endOfMonth.toISOString());
      if (transactionsError) throw transactionsError;

      const incoming = transactionsData
        .filter((t) => t.transaction_type === 'ADD')
        .reduce((sum, t) => sum + (t.quantity || 0), 0);
      const outgoing = transactionsData
        .filter((t) => t.transaction_type === 'DISTRIBUTE')
        .reduce((sum, t) => sum + (t.quantity || 0), 0);

      setIncomingThisMonth(incoming);
      setOutgoingThisMonth(outgoing);
      setError(null);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch and real-time subscriptions
  useEffect(() => {
    if (user) {
      fetchDashboardData();

      const inventorySubscription = supabase
        .channel('inventory')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'inventory' },
          () => {
            fetchDashboardData();
          }
        )
        .subscribe();

      const transactionsSubscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'transactions' },
          () => {
            fetchDashboardData();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(inventorySubscription);
        supabase.removeChannel(transactionsSubscription);
      };
    }
  }, [user]);

  // Render loading or error states
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
            <p>Loading dashboard...</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

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
            <p>Please log in to view the dashboard.</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

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
          <div className="grid auto-rows-min gap-4 md:grid-cols-3">
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #d4f4d4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(220, 252, 231, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">Total Stok Lobster</h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">{totalStock}</p>
                  <Box size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #d4e4f4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(220, 231, 252, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">
                    Jumlah Lobster Masuk Bulan ini
                  </h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">
                    {incomingThisMonth}
                  </p>
                  <FolderInput size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #e4d4f4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(231, 220, 252, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">
                    Jumlah Lobster Dikirim Bulan Ini
                  </h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">
                    {outgoingThisMonth}
                  </p>
                  <FolderOutput size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
          </div>

          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Stock by Lobster Type</h2>
            {stockByType.length === 0 ? (
              <p>
                No inventory data available. Add lobsters via the Add Lobsters
                page.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {stockByType.map((type) => (
                  <Card key={type.lobster_type} className="p-4">
                    <CardHeader>
                      <CardTitle>{type.lobster_type}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p>Total: {type.total_quantity} Ekor</p>
                      <Select
                        onValueChange={() => {
                          setSelectedType(type.lobster_type);
                          if (!weightClasses[type.lobster_type]) {
                            fetchWeightClasses(type.lobster_type);
                          }
                        }}
                      >
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Select Weight Class" />
                        </SelectTrigger>
                        <SelectContent>
                          {weightClasses[type.lobster_type] === undefined ? (
                            <SelectItem value="loading" disabled>
                              Loading weight classes...
                            </SelectItem>
                          ) : weightClasses[type.lobster_type].length > 0 ? (
                            weightClasses[type.lobster_type].map((wc) => (
                              <SelectItem
                                key={wc.weight_range}
                                value={wc.weight_range}
                              >
                                {wc.weight_range}: {wc.quantity} Ekor
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="none" disabled>
                              No weight classes available
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Monthly Trends</h2>
            <ChartBulan
              data={{
                incoming: incomingThisMonth,
                outgoing: outgoingThisMonth,
                total: totalStock,
                stockByType,
              }}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
