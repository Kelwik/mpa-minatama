'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getLobsterTypes, getWeightClasses } from '@/lib/cache';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Box,
  FolderInput,
  FolderOutput,
  Loader2,
  TrendingUp,
  PieChart as PieChartIcon,
} from 'lucide-react';
import { ChartBulan } from '@/components/chart-bulan';
import { ChartJenis } from '@/components/chart-jenis';
import { AppSidebar } from '@/components/app-sidebar';
import { motion } from 'framer-motion';
import debounce from 'lodash/debounce';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [totalStock, setTotalStock] = useState(0);
  const [incomingThisMonth, setIncomingThisMonth] = useState(0);
  const [outgoingThisMonth, setOutgoingThisMonth] = useState(0);
  const [stockByType, setStockByType] = useState([]);
  const [weightClasses, setWeightClasses] = useState({});
  const [chartData, setChartData] = useState([]);
  const [pieChartData, setPieChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

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
      (_, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );

    return () => authListener.subscription?.unsubscribe();
  }, []);

  // Fetch weight classes for a lobster type
  const fetchWeightClasses = useCallback(async (typeId, typeName) => {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), 3000)
      );

      const result = await Promise.race([
        (async () => {
          const { data: inventoryData, error } = await supabase
            .from('inventory')
            .select(
              'weight_class_id, quantity, weight_classes!inner(weight_range)'
            )
            .eq('type_id', typeId)
            .gt('quantity', 0);
          if (error) throw error;

          return inventoryData.map((row) => ({
            weight_range: row.weight_classes?.weight_range || 'Unknown',
            quantity: row.quantity || 0,
          }));
        })(),
        timeoutPromise,
      ]);

      setWeightClasses((prev) => ({ ...prev, [typeName]: result }));
    } catch {
      setWeightClasses((prev) => ({ ...prev, [typeName]: [] }));
    }
  }, []);

  // Fetch dashboard data
  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch cached data
      const [lobsterTypes, weightClassesData] = await Promise.all([
        getLobsterTypes(supabase),
        getWeightClasses(supabase),
      ]);

      // Fetch inventory and transactions in one query
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);

      const [
        { data: inventoryData, error: inventoryError },
        { data: transactionsData, error: transactionsError },
        { data: pieData, error: pieError },
        { data: monthlyData, error: monthlyError },
      ] = await Promise.all([
        supabase.from('inventory').select('type_id, quantity'),
        supabase
          .from('transactions')
          .select('quantity, transaction_type, type_id')
          .gte('transaction_date', startOfMonth.toISOString())
          .lte('transaction_date', endOfMonth.toISOString()),
        supabase
          .from('transactions')
          .select('quantity, transaction_type, type_id')
          .in('transaction_type', ['DISTRIBUTE', 'DEATH', 'DAMAGED']),
        supabase
          .from('transactions')
          .select('quantity, transaction_type, transaction_date')
          .gte('transaction_date', sixMonthsAgo.toISOString()),
      ]);

      if (inventoryError) throw inventoryError;
      if (transactionsError) throw transactionsError;
      if (pieError) throw pieError;
      if (monthlyError) throw monthlyError;

      // Calculate total stock and group by type
      const total = inventoryData.reduce(
        (sum, row) => sum + (row.quantity || 0),
        0
      );
      const grouped = inventoryData.reduce((acc, row) => {
        const type = lobsterTypes.find((t) => t.id === row.type_id);
        const typeName = type?.name || 'Unknown';
        acc[typeName] = (acc[typeName] || 0) + (row.quantity || 0);
        return acc;
      }, {});
      const stockByTypeArray = Object.entries(grouped).map(
        ([name, total_quantity]) => ({
          lobster_type: name,
          total_quantity,
        })
      );

      // Fetch weight classes for each type
      await Promise.all(
        stockByTypeArray.map(({ lobster_type }) => {
          const typeId = lobsterTypes.find((t) => t.name === lobster_type)?.id;
          return typeId ? fetchWeightClasses(typeId, lobster_type) : null;
        })
      );

      // Process transactions
      const incoming = transactionsData
        .filter((t) => t.transaction_type === 'ADD')
        .reduce((sum, t) => sum + (t.quantity || 0), 0);
      const outgoing = Math.abs(
        transactionsData
          .filter((t) =>
            ['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(t.transaction_type)
          )
          .reduce((sum, t) => sum + (t.quantity || 0), 0)
      );

      // Process pie chart data
      const pieGrouped = pieData.reduce((acc, row) => {
        const type = lobsterTypes.find((t) => t.id === row.type_id);
        const typeName = type?.name || 'Unknown';
        acc[typeName] = (acc[typeName] || 0) + Math.abs(row.quantity || 0);
        return acc;
      }, {});
      const pieChartArray = Object.entries(pieGrouped).map(
        ([lobster_type, quantity]) => ({
          lobster_type,
          quantity,
        })
      );

      // Process monthly chart data
      const months = Array.from({ length: 6 }, (_, i) => {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        return {
          month: date.toLocaleString('en-US', { month: 'long' }),
          year: date.getFullYear(),
          monthIndex: date.getMonth(),
        };
      }).reverse();

      const monthlyChartData = months.map(({ month, year, monthIndex }) => {
        const monthTransactions = monthlyData.filter((t) => {
          const date = new Date(t.transaction_date);
          return date.getFullYear() === year && date.getMonth() === monthIndex;
        });

        const incoming = monthTransactions
          .filter((t) => t.transaction_type === 'ADD')
          .reduce((sum, t) => sum + (t.quantity || 0), 0);
        const outgoing = Math.abs(
          monthTransactions
            .filter((t) =>
              ['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(t.transaction_type)
            )
            .reduce((sum, t) => sum + (t.quantity || 0), 0)
        );

        return { month, Masuk: incoming, Keluar: outgoing };
      });

      setTotalStock(total);
      setStockByType(stockByTypeArray);
      setIncomingThisMonth(incoming);
      setOutgoingThisMonth(outgoing);
      setPieChartData(pieChartArray);
      setChartData(monthlyChartData);
      setError(null);
      setLastUpdated(
        new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
      setChartLoading(false);
    }
  }, [fetchWeightClasses]);

  // Debounced fetch for real-time updates
  const debouncedFetchDashboardData = useMemo(
    () =>
      debounce(fetchDashboardData, 1000, { leading: false, trailing: true }),
    [fetchDashboardData]
  );

  // Initial fetch and real-time subscriptions
  useEffect(() => {
    if (user) {
      fetchDashboardData();

      const inventorySubscription = supabase
        .channel('inventory')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory',
            filter: 'quantity=gt.0',
          },
          debouncedFetchDashboardData
        )
        .subscribe();

      const transactionsSubscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'transactions' },
          debouncedFetchDashboardData
        )
        .subscribe();

      return () => {
        supabase.removeChannel(inventorySubscription);
        supabase.removeChannel(transactionsSubscription);
        debouncedFetchDashboardData.cancel();
      };
    }
  }, [user, debouncedFetchDashboardData]);

  // Memoized UI data
  const memoizedChartData = useMemo(() => chartData, [chartData]);
  const memoizedPieChartData = useMemo(() => pieChartData, [pieChartData]);

  // Animation variants
  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.7, staggerChildren: 0.2 },
    },
  };

  // Debug data
  console.log('Dashboard - Chart Data:', memoizedChartData);
  console.log('Dashboard - Pie Chart Data:', memoizedPieChartData);

  // Render loading state
  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Dashboard
            </h1>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-2 sm:p-4 pt-0">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card
                  key={`skeleton-card-${index}`}
                  className="w-full rounded-lg shadow-lg bg-gradient-to-br from-white to-gray-200 dark:from-gray-800 dark:to-gray-700 border border-gray-200 dark:border-gray-700"
                >
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4 bg-gray-300 dark:bg-gray-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-center gap-4 items-center">
                      <Skeleton className="h-16 w-16 rounded-full bg-gray-300 dark:bg-gray-600" />
                      <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-500" />
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Skeleton className="h-4 w-1/2 bg-gray-300 dark:bg-gray-600" />
                  </CardFooter>
                </Card>
              ))}
            </div>
            <div className="mt-8">
              <Skeleton className="h-6 w-1/4 mb-4 bg-gray-200 dark:bg-gray-700" />
              <Skeleton className="h-[250px] sm:h-[350px] w-full rounded-lg bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="mt-8">
              <Skeleton className="h-6 w-1/4 mb-4 bg-gray-200 dark:bg-gray-700" />
              <Skeleton className="h-[250px] sm:h-[350px] w-full rounded-lg bg-gray-200 dark:bg-gray-700" />
            </div>
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
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Dashboard
            </h1>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-2 sm:p-4 pt-0">
            <p className="text-gray-500 dark:text-gray-400">
              Silakan masuk untuk melihat dashboard.
            </p>
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
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Dashboard
            </h1>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-2 sm:p-4 pt-0">
            <p className="text-red-500 dark:text-red-400">Kesalahan: {error}</p>
            <Button
              onClick={fetchDashboardData}
              className="mt-4 w-fit bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white"
            >
              Coba Lagi
            </Button>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Main render
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard
          </h1>
          <Button
            onClick={fetchDashboardData}
            variant="outline"
            size="sm"
            className="ml-auto border-blue-600 text-blue-600 hover:bg-blue-100 dark:border-blue-500 dark:text-blue-500 dark:hover:bg-gray-700"
          >
            <Loader2
              className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`}
            />
            Segarkan
          </Button>
        </header>
        <TooltipProvider>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="flex flex-1 flex-col gap-6 p-2 sm:p-4 pt-0"
          >
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              <motion.div variants={cardVariants}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Card className="w-full rounded-lg shadow-lg bg-gradient-to-br from-white to-gray-200 dark:from-gray-800 dark:to-gray-700 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow duration-200">
                      <CardHeader>
                        <CardTitle>
                          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Total Stok Lobster
                          </h2>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex justify-center items-center gap-4 sm:gap-6">
                          <p className="text-4xl sm:text-5xl xl:text-6xl font-bold text-gray-900 dark:text-gray-100">
                            {totalStock}
                          </p>
                          <Box
                            size={40}
                            className="stroke-blue-600 dark:stroke-blue-500"
                          />
                        </div>
                      </CardContent>
                      <CardFooter>
                        <p className="text-xl sm:text-2xl text-gray-900 dark:text-gray-100">
                          Ekor
                        </p>
                      </CardFooter>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700">
                    <p>Jumlah total lobster saat ini di inventaris.</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Terakhir diperbarui: {lastUpdated}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </motion.div>
              <motion.div variants={cardVariants} transition={{ delay: 0.1 }}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Card className="w-full rounded-lg shadow-lg bg-gradient-to-br from-white to-gray-200 dark:from-gray-800 dark:to-gray-700 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow duration-200">
                      <CardHeader>
                        <CardTitle>
                          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Lobster Masuk Bulan Ini
                          </h2>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex justify-center items-center gap-4 sm:gap-6">
                          <p className="text-4xl sm:text-5xl xl:text-6xl font-bold text-gray-900 dark:text-gray-100">
                            {incomingThisMonth}
                          </p>
                          <FolderInput
                            size={40}
                            className="stroke-blue-600 dark:stroke-blue-500"
                          />
                        </div>
                      </CardContent>
                      <CardFooter>
                        <p className="text-xl sm:text-2xl text-gray-900 dark:text-gray-100">
                          Ekor
                        </p>
                      </CardFooter>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700">
                    <p>Jumlah lobster yang ditambahkan bulan ini.</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Terakhir diperbarui: {lastUpdated}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </motion.div>
              <motion.div variants={cardVariants} transition={{ delay: 0.2 }}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Card className="w-full rounded-lg shadow-lg bg-gradient-to-br from-white to-gray-200 dark:from-gray-800 dark:to-gray-700 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow duration-200">
                      <CardHeader>
                        <CardTitle>
                          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Lobster Keluar Bulan Ini
                          </h2>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex justify-center items-center gap-4 sm:gap-6">
                          <p className="text-4xl sm:text-5xl xl:text-6xl font-bold text-gray-900 dark:text-gray-100">
                            {Math.abs(outgoingThisMonth)}
                          </p>
                          <FolderOutput
                            size={40}
                            className="stroke-blue-600 dark:stroke-blue-500"
                          />
                        </div>
                      </CardContent>
                      <CardFooter>
                        <p className="text-xl sm:text-2xl text-gray-900 dark:text-gray-100">
                          Ekor
                        </p>
                      </CardFooter>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700">
                    <p>
                      Jumlah lobster yang didistribusikan, mati, atau rusak
                      bulan ini.
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Terakhir diperbarui: {lastUpdated}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </motion.div>
            </div>

            <motion.div variants={cardVariants} className="mt-8">
              <Card className="w-full mb-4  ">
                <CardHeader className="flex flex-row items-center gap-2">
                  <TrendingUp
                    size={24}
                    className="text-blue-600 dark:text-blue-500"
                  />
                  <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                    Tren Bulanan
                  </CardTitle>
                </CardHeader>
              </Card>
              {chartLoading ? (
                <Skeleton className="h-[250px] sm:h-[350px] w-full rounded-lg bg-gray-200 dark:bg-gray-700" />
              ) : (
                <ChartBulan chartData={memoizedChartData} />
              )}
            </motion.div>

            <motion.div variants={cardVariants} className="mt-8">
              <Card className="w-full mb-4 ">
                <CardHeader className="flex flex-row items-center gap-2">
                  <PieChartIcon
                    size={24}
                    className="text-blue-600 dark:text-blue-500"
                  />
                  <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                    Distribusi Berdasarkan Jenis Lobster
                  </CardTitle>
                </CardHeader>
              </Card>
              {chartLoading ? (
                <Skeleton className="h-[250px] sm:h-[350px] w-full rounded-lg bg-gray-200 dark:bg-gray-700" />
              ) : (
                <ChartJenis chartData={memoizedPieChartData} />
              )}
            </motion.div>
          </motion.div>
        </TooltipProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
