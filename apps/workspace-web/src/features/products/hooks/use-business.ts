// V2-J1 · truy vấn điểm kinh doanh sản phẩm (danh sách · chi tiết · hợp đồng) cho trang SP và khối Tổng quan.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { bizKeys, fetchBizContracts, fetchBizDetail, fetchBizPage, fetchBizProducts } from "../api";

export const useBizProducts = () =>
  useQuery({ queryKey: bizKeys.list, queryFn: ({ signal }) => fetchBizProducts(signal) });

export const useBizPage = (o: { group?: string; q: string; offset: number; limit: number }) =>
  useQuery({
    queryKey: [...bizKeys.list, "page", o],
    queryFn: ({ signal }) => fetchBizPage(o, signal),
    placeholderData: keepPreviousData,
  });

export const useBizDetail = (id: string) =>
  useQuery({
    queryKey: bizKeys.detail(id),
    queryFn: ({ signal }) => fetchBizDetail(id, signal),
  });

export const useBizContracts = (id: string) =>
  useQuery({
    queryKey: bizKeys.contracts(id),
    queryFn: ({ signal }) => fetchBizContracts(id, signal),
  });
